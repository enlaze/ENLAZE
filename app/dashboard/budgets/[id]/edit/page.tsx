"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { BudgetForm } from "../../_components/budget-form";

export default function EditBudgetPage() {
  const params = useParams<{ id: string }>();
  return (
    <div>
      <div className="mx-auto mb-4 flex max-w-5xl justify-end">
        <Link
          href={`/dashboard/budgets/generate?budgetId=${params.id}`}
          className="inline-flex items-center justify-center rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-navy-900 transition hover:bg-brand-green/90"
        >
          Editar alcance, partidas y proveedores
        </Link>
      </div>
      <BudgetForm editBudgetId={params.id} />
    </div>
  );
}
