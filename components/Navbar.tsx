'use client';

import Logo from "./Logo";

export default function Navbar() {
  return (
    <div className="w-full flex items-center justify-between px-6 py-4 border-b bg-white">
      <Logo />
    </div>
  );
}