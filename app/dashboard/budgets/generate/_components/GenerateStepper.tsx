"use client";

import React from "react";
import { useBudgetGenerate } from "./BudgetGenerateProvider";

export interface StepDef {
  id: string;
  label: string;
}

export function GenerateStepper({ steps }: { steps: StepDef[] }) {
  const { state, goToStep } = useBudgetGenerate();
  const { currentStep } = state;

  return (
    <div className="w-full bg-white dark:bg-zinc-900 border-b border-navy-100 dark:border-zinc-800 p-4 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2 w-full">
          {steps.map((step, idx) => {
            const isActive = idx === currentStep;
            const isPast = idx < currentStep;
            
            return (
              <React.Fragment key={step.id}>
                <div 
                  className={`flex items-center group ${isPast || isActive ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                  onClick={() => {
                    if (isPast || isActive) goToStep(idx);
                  }}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                    isActive 
                      ? "bg-brand-green border-brand-green text-navy-900" 
                      : isPast 
                        ? "bg-brand-green/20 border-brand-green text-brand-green"
                        : "bg-navy-50 border-navy-200 text-navy-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-500"
                  }`}>
                    {idx + 1}
                  </div>
                  <span className={`ml-2 text-sm font-medium hidden sm:block ${
                    isActive ? "text-navy-900 dark:text-white" : "text-navy-500 dark:text-zinc-400"
                  }`}>
                    {step.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-4 transition-colors ${
                    isPast ? "bg-brand-green" : "bg-navy-100 dark:bg-zinc-800"
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
