import { redirect } from "next/navigation";

// /admin/feedback consolidated into the /admin console (2026-08-27). Kept as a
// permanent redirect so old bookmarks and in-product links don't 404.
export default function AdminFeedbackRedirect() {
  redirect("/admin"); // issues 308
}
