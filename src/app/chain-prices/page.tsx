import { redirect } from "next/navigation";

export default function ChainPricesRedirect() {
  redirect("/?tab=compare");
}
