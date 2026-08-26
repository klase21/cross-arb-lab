import { redirect } from "next/navigation";

export default function SimulatorRedirect() {
  redirect("/?tab=simulator");
}
