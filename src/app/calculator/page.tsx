import { redirect } from "next/navigation";

export default function CalculatorRedirect() {
  redirect("/?tab=calculator");
}
