import { Suspense } from "react";
import OrderConfirmation from "@/components/order-confirmation";

async function SuccessContent({
  params,
}: PageProps<"/[locale]/success/[orderNumber]">) {
  const { orderNumber } = await params;
  // The hosted checkout returns to /success/<orderNumber>; the number in the
  // URL is for display only, the confirmation comes from the API.
  const shown = /^\d+$/.test(orderNumber) ? Number(orderNumber) : null;
  return <OrderConfirmation orderNumberFromUrl={shown} />;
}

export default function SuccessPage(
  props: PageProps<"/[locale]/success/[orderNumber]">,
) {
  return (
    <Suspense fallback={<div className="order-page" role="status" aria-busy />}>
      <SuccessContent {...props} />
    </Suspense>
  );
}
