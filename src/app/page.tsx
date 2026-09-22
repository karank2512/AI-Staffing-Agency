import { redirect } from "next/navigation";

// The app has no marketing page: "/" is the workforce dashboard (the middleware sends signed-out visitors to /sign-in).
export default function RootPage(): never {
  redirect("/workforce");
}
