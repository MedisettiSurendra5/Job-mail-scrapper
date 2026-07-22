import { Link } from "react-router-dom";
import type { Job } from "./api";

interface JobCalendarProps {
  jobs: Job[];
  monthCursor: Date;
  onMonthChange: (next: Date) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Jobs are plotted by the UTC day of job.datePosted (see
// server/src/automation/jobright.ts parsePublishTime), so the grid is built
// and read entirely in UTC too - otherwise a viewer west/east of UTC would
// see a job shifted onto the wrong day.
export function JobCalendar({ jobs, monthCursor, onMonthChange }: JobCalendarProps) {
  const year = monthCursor.getUTCFullYear();
  const month = monthCursor.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();

  const jobsByDay = new Map<number, Job[]>();
  for (const job of jobs) {
    if (!job.datePosted) continue;
    const posted = new Date(job.datePosted);
    if (posted.getUTCFullYear() === year && posted.getUTCMonth() === month) {
      const day = posted.getUTCDate();
      const list = jobsByDay.get(day) ?? [];
      list.push(job);
      jobsByDay.set(day, list);
    }
  }

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="card job-calendar">
      <div className="job-calendar-head">
        <button
          type="button"
          className="btn-secondary btn-small"
          onClick={() => onMonthChange(new Date(Date.UTC(year, month - 1, 1)))}
        >
          ← Prev
        </button>
        <h3>{monthLabel}</h3>
        <button
          type="button"
          className="btn-secondary btn-small"
          onClick={() => onMonthChange(new Date(Date.UTC(year, month + 1, 1)))}
        >
          Next →
        </button>
      </div>
      <div className="job-calendar-grid job-calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="job-calendar-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="job-calendar-grid">
        {cells.map((day, i) => {
          const dayJobs = day ? jobsByDay.get(day) ?? [] : [];
          return (
            <div key={i} className={`job-calendar-cell${day ? "" : " job-calendar-cell-blank"}`}>
              {day && (
                <>
                  <div className="job-calendar-daynum">{day}</div>
                  {dayJobs.slice(0, 3).map((job) => (
                    <Link
                      key={job.id}
                      to={`/jobs/${job.id}`}
                      className="job-calendar-job"
                      title={job.title || job.url}
                    >
                      {job.title || job.url}
                    </Link>
                  ))}
                  {dayJobs.length > 3 && <div className="muted small">+{dayJobs.length - 3} more</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
