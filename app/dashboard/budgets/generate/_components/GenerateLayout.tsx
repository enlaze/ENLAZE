"use client";

import React, { ReactNode } from "react";
import { LiveSummaryPanel } from "./LiveSummaryPanel";

export function GenerateLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 py-6">
      <div className="lg:col-span-8 space-y-6">
        {children}
      </div>
      <div className="lg:col-span-4">
        <LiveSummaryPanel />
      </div>
    </div>
  );
}
