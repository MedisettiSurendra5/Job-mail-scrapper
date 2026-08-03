import fs from "fs";
import { prisma } from "./db";
import { resumePathFor } from "./paths";

// Every table with a required (RESTRICT) FK to User must be emptied before
// the User row itself can go - see schema.prisma. Contact.sentById and
// AutomationRule.sendAsUserId are ON DELETE SET NULL and need no cleanup
// here; a job's contacts still block deleting the job itself, so those go
// first regardless of who sent them.
export async function deleteUserAccount(userId: number): Promise<void> {
  const resumes = await prisma.resume.findMany({ where: { userId }, select: { id: true } });

  await prisma.$transaction([
    prisma.contact.deleteMany({ where: { job: { addedById: userId } } }),
    prisma.job.deleteMany({ where: { addedById: userId } }),
    prisma.resume.deleteMany({ where: { userId } }),
    prisma.trackedApplication.deleteMany({ where: { userId } }),
    prisma.promoRedemption.deleteMany({ where: { userId } }),
    // Codes this user created are about to be deleted too - their
    // redemptions (by other members) have to go first, same RESTRICT reason.
    prisma.promoRedemption.deleteMany({ where: { promoCode: { createdById: userId } } }),
    prisma.promoCode.deleteMany({ where: { createdById: userId } }),
    prisma.automationRule.deleteMany({ where: { createdById: userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  for (const r of resumes) fs.rmSync(resumePathFor(r.id), { force: true });
}
