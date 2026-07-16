"""
jobright.ai outreach automation.

Flow:
  1. Log in to jobright.ai
  2. Search SEARCH_TERM, apply filters (Entry + Mid level, Contract, Past 24 hours)
  3. Scroll-collect every job card in the (virtualized) results list
  4. For each job -> open it directly via its URL -> read job title/company from
     jobright's own embedded JSON (reliable, not scraped from CSS classes) ->
     expand every "Insider Connection" group -> for each contact, click the mail
     icon -> Connect Now -> jobright reveals an email + AI-written subject/body
     in a "Connect Via Email" modal -> scrape those three fields -> send that
     exact subject/body via Gmail SMTP with your resume attached.
  5. Every contact is logged to sent_log.csv (found or not, sent or not), and
     anyone already marked "sent" there is skipped on future runs so nobody
     gets emailed twice. Every job ID is logged too, so already-processed jobs
     are skipped on reruns.

IMPORTANT - before you run this for real:
  - jobright.ai's Terms of Service may prohibit automated/bot access. Using
    this can get your account flagged or suspended. That's a risk you're
    taking on knowingly by running this script.
  - Run with DRY_RUN=true first (the default). It does everything except
    actually send email, so you can confirm it's grabbing the right people
    before you fire real messages at real contacts.
  - Selectors here were verified against the live site's rendered DOM as of
    2026-07-16. If jobright changes their frontend, things will break -
    rerun with HEADLESS=false to watch it, or ask for the selectors to be
    re-verified.
"""

import csv
import json
import os
import random
import re
import smtplib
import time
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import Page, TimeoutError as PWTimeoutError, sync_playwright

load_dotenv()

JOBRIGHT_EMAIL = os.environ["JOBRIGHT_EMAIL"]
JOBRIGHT_PASSWORD = os.environ["JOBRIGHT_PASSWORD"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

SEARCH_TERM = os.environ.get("SEARCH_TERM", "data center technician")
RESUME_PATH = Path(os.environ.get("RESUME_PATH", "resume.pdf"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
HEADLESS = os.environ.get("HEADLESS", "true").lower() == "true"
MAX_JOBS = int(os.environ.get("MAX_JOBS", "0"))  # 0 = no limit
MAX_EMAILS = int(os.environ.get("MAX_EMAILS", "10"))  # stop once this many emails are found/handled, 0 = no limit

STATE_FILE = Path("jobright_state.json")
LOG_CSV = Path("sent_log.csv")
LOG_FIELDS = [
    "timestamp", "job_id", "company", "job_title", "contact_name",
    "contact_title", "email", "status", "subject", "email_body", "note",
]

MIN_DELAY = 1.5
MAX_DELAY = 3.5
EMAIL_MIN_DELAY = 20.0  # seconds between actual sent emails - avoid spam flags
EMAIL_MAX_DELAY = 45.0

CONTACT_SIGNATURE = "Phone: 901-451-9705\nEmail: Surendramedisetti99@gmail.com"


def clean_email_body(raw: str) -> str:
    """jobright's rich-text editor renders each blank line as its own <p><br></p>,
    which .inner_text() turns into runs of several blank lines. Collapse any run
    of 2+ blank lines down to exactly one, and append contact details."""
    text = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", raw.strip())
    return f"{text}\n\n{CONTACT_SIGNATURE}"


def human_pause(lo=MIN_DELAY, hi=MAX_DELAY):
    time.sleep(random.uniform(lo, hi))


def safe_wait(page: Page, timeout=8000):
    try:
        page.wait_for_load_state("networkidle", timeout=timeout)
    except Exception:
        pass


def load_contacted_emails() -> set:
    if not LOG_CSV.exists():
        return set()
    with LOG_CSV.open(newline="", encoding="utf-8") as f:
        return {
            row["email"].strip().lower()
            for row in csv.DictReader(f)
            if row.get("email") and row.get("status") == "sent"
        }


def load_processed_job_ids() -> set:
    if not LOG_CSV.exists():
        return set()
    with LOG_CSV.open(newline="", encoding="utf-8") as f:
        return {
            row["job_id"]
            for row in csv.DictReader(f)
            if row.get("job_id") and row.get("status") in ("no_insider_connections", "job_done")
        }


def log_row(job_id, company, job_title, contact_name, contact_title, email, status,
            subject="", email_body="", note=""):
    is_new = not LOG_CSV.exists()
    with LOG_CSV.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if is_new:
            writer.writeheader()
        writer.writerow({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "job_id": job_id,
            "company": company,
            "job_title": job_title,
            "contact_name": contact_name,
            "contact_title": contact_title,
            "email": email,
            "status": status,
            "subject": subject,
            "email_body": email_body,
            "note": note,
        })


def send_outreach_email(to_email: str, subject: str, body_text: str):
    msg = EmailMessage()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)

    if not RESUME_PATH.exists():
        raise FileNotFoundError(f"Resume not found at {RESUME_PATH}")
    msg.add_attachment(
        RESUME_PATH.read_bytes(),
        maintype="application",
        subtype="pdf",
        filename=RESUME_PATH.name,
    )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)


# ---------------------------------------------------------------------------
# jobright.ai UI automation
# ---------------------------------------------------------------------------

def dismiss_any_modal(page: Page) -> bool:
    try:
        close_btn = page.locator(".ant-modal-close")
        if close_btn.count() and close_btn.first.is_visible():
            close_btn.first.click(timeout=3000)
            time.sleep(0.6)
            return True
    except Exception:
        pass
    return False


def dismiss_orion_popup(page: Page):
    try:
        exit_btn = page.get_by_text("EXIT", exact=False).first
        if exit_btn.is_visible():
            exit_btn.click(timeout=2000)
            time.sleep(0.6)
    except Exception:
        pass


def robust_click(page: Page, locator, retries=5, timeout=3000, pause=0.8):
    """jobright pops up promo modals ('Jobright Agent', 'Orion resume boost',
    etc.) at unpredictable moments, which silently intercept clicks anywhere
    in the flow. Dismiss whatever's blocking and retry rather than failing."""
    last_err = None
    for _ in range(retries):
        dismiss_orion_popup(page)
        dismiss_any_modal(page)
        try:
            locator.click(timeout=timeout)
            return
        except Exception as e:
            last_err = e
            time.sleep(pause)
    raise last_err


def login(page: Page):
    page.goto("https://jobright.ai/", wait_until="domcontentloaded")
    time.sleep(2)

    robust_click(page, page.get_by_text("Sign in", exact=False).first, timeout=6000)
    time.sleep(1.5)

    page.get_by_placeholder("Email").fill(JOBRIGHT_EMAIL, timeout=10000)
    page.get_by_placeholder("Password").fill(JOBRIGHT_PASSWORD, timeout=10000)
    robust_click(page, page.get_by_role("button", name="Sign in", exact=False), timeout=6000)

    safe_wait(page)
    time.sleep(2)


def search_jobs(page: Page, term: str):
    box = page.get_by_placeholder("Search by title or company", exact=False)
    robust_click(page, box.first, timeout=6000)
    box.first.fill(term)
    box.first.press("Enter")
    safe_wait(page)
    time.sleep(3)
    dismiss_orion_popup(page)
    dismiss_any_modal(page)  # "Jobright Agent" promo tends to pop up here


def apply_dropdown_filter(page: Page, pref_key: str, option_labels: list):
    robust_click(page, page.locator(f'[data-preference-key="{pref_key}"]').first, timeout=6000)
    time.sleep(1)
    for label in option_labels:
        opt = page.locator(
            "label.ant-checkbox-wrapper, label.ant-radio-wrapper", has_text=label
        ).first
        robust_click(page, opt, timeout=4000)
        time.sleep(0.6)

    # The Confirm button's accessible name includes a live result count, e.g.
    # "Confirm(26)" - must use a substring match, not exact.
    confirm = page.get_by_role("button", name="Confirm", exact=False).first
    robust_click(page, confirm, timeout=2500)
    time.sleep(1.2)


def apply_filters(page: Page):
    apply_dropdown_filter(page, "seniority", ["Entry Level", "Mid Level"])
    apply_dropdown_filter(page, "jobTypes", ["Contract"])
    apply_dropdown_filter(page, "daysAgo", ["Past 24 hours"])


def get_result_count(page: Page) -> int | None:
    try:
        text = page.get_by_text(re.compile(r"\d+ results for"), exact=False).first.inner_text()
        m = re.search(r"(\d+) results", text)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def collect_all_job_ids(page: Page, max_scrolls=60) -> list:
    """The results list is virtualized - only cards near the viewport exist in
    the DOM. Scroll the list container repeatedly, collecting job card ids as
    they mount, until scrolling stops revealing new ones."""
    expected = get_result_count(page)
    seen_order = []
    seen_set = set()
    stagnant = 0

    def current_ids():
        return page.locator('div[class*="index_job-card__"]').evaluate_all(
            "els => els.map(e => e.id).filter(Boolean)"
        )

    for ids in current_ids(),:
        for i in ids:
            if i not in seen_set:
                seen_set.add(i)
                seen_order.append(i)

    for _ in range(max_scrolls):
        if expected and len(seen_order) >= expected:
            break
        try:
            page.locator('div[class*="index_job-card__"]').last.scroll_into_view_if_needed(timeout=3000)
        except Exception:
            page.mouse.wheel(0, 900)
        time.sleep(1.0)

        before = len(seen_order)
        for i in current_ids():
            if i not in seen_set:
                seen_set.add(i)
                seen_order.append(i)
        if len(seen_order) == before:
            stagnant += 1
        else:
            stagnant = 0
        if stagnant >= 4:
            break

    print(f"Collected {len(seen_order)} job id(s)" + (f" (site reported {expected})" if expected else ""))
    return seen_order


def extract_job_json(page: Page) -> dict:
    raw = page.locator("#jobright-helper-job-detail-info").inner_text(timeout=8000)
    return json.loads(raw)


def expand_all_connection_groups(page: Page):
    view_buttons = page.get_by_role("button", name="View", exact=False)
    for i in range(view_buttons.count()):
        try:
            robust_click(page, view_buttons.nth(i), timeout=3000)
        except Exception:
            continue
        # Expanding a group is async on jobright's end - a fixed sleep is not
        # reliably long enough. Wait for an actual mail-icon to mount instead.
        try:
            page.locator('button:has(img[alt="mail-icon"])').first.wait_for(state="visible", timeout=8000)
        except PWTimeoutError:
            pass


class EmailBudget:
    """Caps how many emails get found/handled in a single run (MAX_EMAILS)."""

    def __init__(self, limit: int):
        self.limit = limit
        self.count = 0

    def has_room(self) -> bool:
        return self.limit == 0 or self.count < self.limit

    def spend(self):
        self.count += 1


def reveal_and_send_for_contact(page: Page, mail_button, job_id, company, job_title, contacted: set, budget: "EmailBudget") -> str:
    robust_click(page, mail_button, timeout=4000)
    time.sleep(1.5)

    name, title = "", ""
    try:
        name = page.locator('[class*="finish-card-name"]').first.inner_text(timeout=3000).strip()
        title = page.locator('[class*="finish-card-contact-job"]').first.inner_text(timeout=3000).strip()
    except Exception:
        pass

    # jobright sometimes can't find a work email at all for a contact - the
    # panel then reads "Contact Info Not Found!" and offers "Connect On
    # LinkedIn" instead of "Connect Now". Treat that as no email available
    # rather than silently dropping the contact.
    connect_btn = page.get_by_role("button", name="Connect Now", exact=False).first
    try:
        connect_btn.wait_for(state="visible", timeout=5000)
    except PWTimeoutError:
        print(f"   no email available for this contact ({name or 'unknown'})")
        log_row(job_id, company, job_title, name, title, "", "no_email_found", note="no Connect Now option")
        return "no_email_found"
    robust_click(page, connect_btn, timeout=4000)
    time.sleep(1.5)

    email_input = page.locator("#email")
    try:
        email_input.wait_for(state="visible", timeout=6000)
    except PWTimeoutError:
        dismiss_any_modal(page)
        log_row(job_id, company, job_title, name, title, "", "no_email_found")
        return "no_email_found"

    email = (email_input.input_value() or "").strip().lower()
    subject = (page.locator("#subject").input_value() or "").strip()
    body = clean_email_body(page.locator("#body .ql-editor").inner_text(timeout=3000))

    dismiss_any_modal(page)  # close "Connect Via Email" - we send via our own SMTP, not "Start Email"

    if not email:
        log_row(job_id, company, job_title, name, title, "", "no_email_found")
        return "no_email_found"

    if email in contacted:
        log_row(job_id, company, job_title, name, title, email, "skipped_duplicate")
        print(f"   skip (already contacted): {email}")
        return "duplicate"

    if DRY_RUN:
        print(f"   [DRY RUN] would email {email} ({name}, {title}) - subject: {subject!r}")
        log_row(job_id, company, job_title, name, title, email, "dry_run", subject=subject, email_body=body)
    else:
        try:
            send_outreach_email(email, subject, body)
            print(f"   sent to {email}")
            log_row(job_id, company, job_title, name, title, email, "sent", subject=subject, email_body=body)
            contacted.add(email)
            human_pause(EMAIL_MIN_DELAY, EMAIL_MAX_DELAY)
        except Exception as e:
            print(f"   FAILED to send to {email}: {e}")
            log_row(job_id, company, job_title, name, title, email, "send_failed",
                    subject=subject, email_body=body, note=str(e))

    budget.spend()
    return "handled"


def process_job(page: Page, job_id: str, contacted: set, budget: "EmailBudget"):
    page.goto(f"https://jobright.ai/jobs/info/{job_id}", wait_until="domcontentloaded")
    safe_wait(page)
    time.sleep(1.5)
    dismiss_orion_popup(page)
    dismiss_any_modal(page)

    try:
        data = extract_job_json(page)
    except Exception as e:
        print(f"   could not read job JSON for {job_id}: {e}")
        return

    job_title = data.get("jobResult", {}).get("jobTitle", "")
    company = data.get("companyResult", {}).get("companyName", "")
    connections = data.get("jobResult", {}).get("socialConnections") or []

    print(f"-> {job_title} @ {company} ({len(connections)} insider connection(s))")

    if not connections:
        log_row(job_id, company, job_title, "", "", "", "no_insider_connections")
        return

    try:
        page.get_by_text("Insider Connection", exact=False).first.scroll_into_view_if_needed(timeout=5000)
        time.sleep(1)
    except Exception:
        pass

    expand_all_connection_groups(page)

    mail_buttons = page.locator('button:has(img[alt="mail-icon"])')
    n = mail_buttons.count()
    for i in range(n):
        if not budget.has_room():
            print(f"   reached MAX_EMAILS limit ({MAX_EMAILS}), stopping mid-job - rerun later to pick up the rest")
            return  # don't mark job_done - remaining contacts get picked up on the next run
        try:
            reveal_and_send_for_contact(page, mail_buttons.nth(i), job_id, company, job_title, contacted, budget)
        except Exception as e:
            print(f"   error on contact {i}: {e}")
            dismiss_any_modal(page)
        human_pause()

    log_row(job_id, company, job_title, "", "", "", "job_done")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def run():
    contacted = load_contacted_emails()
    processed_jobs = load_processed_job_ids()
    budget = EmailBudget(MAX_EMAILS)
    print(f"{len(contacted)} previously contacted email(s), {len(processed_jobs)} previously fully-processed job(s)")
    print(f"MAX_EMAILS={MAX_EMAILS or 'unlimited'} for this run")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, slow_mo=80)

        if STATE_FILE.exists():
            context = browser.new_context(storage_state=str(STATE_FILE))
            page = context.new_page()
            print("Reusing saved login session...")
            page.goto("https://jobright.ai/jobs/recommend", wait_until="domcontentloaded")
            time.sleep(2)
        else:
            context = browser.new_context()
            page = context.new_page()
            print("Logging in...")
            login(page)
            context.storage_state(path=str(STATE_FILE))

        print(f"Searching for '{SEARCH_TERM}'...")
        search_jobs(page, SEARCH_TERM)

        print("Applying filters...")
        apply_filters(page)
        safe_wait(page)
        time.sleep(1)

        job_ids = collect_all_job_ids(page)
        job_ids = [j for j in job_ids if j not in processed_jobs]
        if MAX_JOBS:
            job_ids = job_ids[:MAX_JOBS]
        print(f"{len(job_ids)} job(s) to process this run.")

        for job_id in job_ids:
            if not budget.has_room():
                print(f"Reached MAX_EMAILS limit ({MAX_EMAILS}), stopping.")
                break
            try:
                process_job(page, job_id, contacted, budget)
            except Exception as e:
                print(f"error processing job {job_id}: {e}")
            human_pause()

        browser.close()

    print("Done.")


if __name__ == "__main__":
    run()
