// Applied to any error text that ends up in a user-visible field
// (Job.errorMessage, Contact.errorMessage, Task.error). Custom thrown errors
// in automation/jobright.ts are already written brand-neutral, but raw
// exceptions (Playwright timeouts, etc.) can still mention internal details
// like the "jobright-helper-job-detail-info" DOM id - strip the brand name
// out of whatever text actually lands in the database.
export function sanitizeErrorMessage(message: string): string {
  return message.replace(/jobright/gi, "the job board");
}
