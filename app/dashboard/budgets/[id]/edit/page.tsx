"use client";

import { useParams } from "next/navigation";
import { BudgetForm } from "../../_components/budget-form";

export default function EditBudgetPage() {
  const params = useParams<{ id: string }>();
  return <BudgetForm editBudgetId={params.id} />;
}
