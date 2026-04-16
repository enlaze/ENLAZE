# Dark Mode Implementation Guide

## Overview

ENLAZE features a complete dark mode implementation with:
- React Context for theme state management
- Persistent storage (localStorage + Supabase user metadata)
- System preference detection (prefers-color-scheme)
- No Flash of Wrong Theme (FOWT) - inline script prevents theme flashing on page load
- Smooth CSS transitions between light and dark modes
- Three theme options: Light, Dark, and System (auto-detect)

## How Dark Mode Works

### Theme Context (`lib/theme-context.tsx`)
- Manages theme state with three modes: `"light"`, `"dark"`, `"system"`
- Syncs to localStorage for persistence across sessions
- Syncs to Supabase user metadata for authenticated users
- Falls back to system preference if no saved preference exists
- Listens for system theme changes when in "system" mode

### Theme Toggle Component (`components/ThemeToggle.tsx`)
- Three-option dropdown menu (Light, Dark, System)
- Located in dashboard topbar (next to notifications and user menu)
- Visual feedback showing current theme selection
- Moon icon for dark mode, sun icon for light mode

### Root Layout Script (`app/layout.tsx`)
- Inline script runs BEFORE React hydrates
- Reads localStorage and applies theme immediately
- Prevents white flash when theme is set to dark
- Uses `data-theme` attribute and `.dark` class for styling

## Color Palette

### Light Mode (Default)
```css
--color-navy-50:   #f4f7fa   /* Lightest background */
--color-navy-100:  #e8eef4
--color-navy-200:  #d0dce8
--color-navy-300:  #a8bccf
--color-navy-400:  #8899a8
--color-navy-500:  #5a6f83
--color-navy-600:  #3b5068
--color-navy-700:  #1e3a5f
--color-navy-800:  #0f2744
--color-navy-900:  #0a1929
--color-navy-950:  #060f1a   /* Darkest text */
```

### Dark Mode
```css
--color-navy-50:   #0f1419   /* Darkest background */
--color-navy-100:  #151b24
--color-navy-200:  #1e2633
--color-navy-300:  #2a3344
--color-navy-400:  #4a5568
--color-navy-500:  #6b7684
--color-navy-600:  #8b95a5
--color-navy-700:  #b0b9c8
--color-navy-800:  #d9e1ea
--color-navy-900:  #f5f7fa
--color-navy-950:  #ffffff   /* Lightest text */
```

### Accent Colors (Same in Both Modes)
```css
--color-brand-green:       #00c896
--color-brand-green-dark:  #00a67a
--color-brand-green-light: #00e6ac
```

## How to Add Dark Mode to New Components

### Method 1: Using Tailwind Classes (Recommended)
```tsx
// Light mode content, dark mode suffix
<div className="bg-white text-navy-900 dark:bg-navy-900 dark:text-navy-50">
  <button className="bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-300">
    Click me
  </button>
</div>
```

### Method 2: Using CSS Variables
```tsx
<div className="bg-[var(--color-navy-50)] text-[var(--color-navy-950)]">
  Content
</div>
```

### Method 3: Using CSS Transitions
```tsx
<div className="bg-white transition-colors dark:bg-navy-900">
  Smooth transition between modes
</div>
```

## Common Pattern: Buttons

```tsx
// Primary button
<button className="
  bg-navy-900 text-white
  dark:bg-brand-green dark:text-navy-900
  hover:bg-navy-800 dark:hover:bg-brand-green-dark
  transition-all
" />

// Secondary button
<button className="
  border border-navy-200 bg-white text-navy-800
  dark:border-navy-700 dark:bg-navy-800 dark:text-navy-100
  hover:bg-navy-50 dark:hover:bg-navy-700
  transition-colors
" />
```

## Common Pattern: Cards

```tsx
<article className="
  rounded-2xl border border-navy-100 bg-white p-6
  shadow-[0_1px_2px_rgba(10,25,41,0.04)]
  dark:border-navy-700 dark:bg-navy-800 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]
  transition-all duration-300
  hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
  dark:hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.4)]
" />
```

## Common Pattern: Text

```tsx
{/* Headings */}
<h1 className="text-navy-900 dark:text-navy-50 transition-colors" />

{/* Body text */}
<p className="text-navy-600 dark:text-navy-400 transition-colors" />

{/* Secondary text */}
<span className="text-navy-500 dark:text-navy-600 transition-colors" />
```

## Styling Backgrounds

```tsx
{/* Simple background */}
<div className="bg-navy-50 dark:bg-navy-900" />

{/* Gradient background */}
<div className="bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fa_280px)] dark:bg-[linear-gradient(180deg,#0f1a2e_0%,#050a15_280px)]" />

{/* Radial gradient */}
<div className="bg-[radial-gradient(ellipse_at_top,rgba(0,200,150,0.10),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(0,200,150,0.08),transparent_55%)]" />
```

## Testing Dark Mode

### In Browser DevTools
1. Open DevTools (F12)
2. Go to Console
3. Run: `document.documentElement.classList.add('dark')` (enable)
4. Run: `document.documentElement.classList.remove('dark')` (disable)
5. Or use the theme toggle button in the dashboard

### System Preference
- **macOS**: System Preferences > General > Appearance
- **Windows 11**: Settings > Personalization > Colors
- **Linux**: Depends on desktop environment (GNOME, KDE, etc.)

### Manual Testing Checklist
- [ ] Light mode loads without flash
- [ ] Dark mode loads without flash
- [ ] Toggle between light and dark works smoothly
- [ ] Theme persists after page reload
- [ ] Theme respects system preference on first visit
- [ ] All cards have proper contrast in dark mode
- [ ] All text is readable in dark mode
- [ ] Buttons look good in both modes
- [ ] Hover states work in both modes
- [ ] Form elements visible in dark mode
- [ ] Images look good with dark background
- [ ] Charts/graphs visible in dark mode

## Transitions

Use `transition-colors` for smooth theme switches:
```tsx
<div className="bg-white text-navy-900 transition-colors dark:bg-navy-900 dark:text-navy-50">
  Smooth 300ms transition by default
</div>
```

For custom duration:
```tsx
<div className="transition-colors duration-500 ...">
  Slower 500ms transition
</div>
```

## Icons and SVGs

Make sure icons inherit color:
```tsx
<svg className="text-navy-700 dark:text-navy-300 transition-colors" stroke="currentColor">
  {/* SVG content */}
</svg>
```

## Accessibility

- Ensure sufficient contrast in dark mode (WCAG AA minimum)
- Test with color blindness simulators
- Use system preference as default (respects user's OS setting)
- Provide manual override option (theme toggle)

## Performance Notes

- CSS-based dark mode (no JavaScript overhead)
- Inline script prevents FOWT (Flash of Wrong Theme)
- Theme stored in localStorage for instant access
- Supabase sync happens in background
- Smooth transitions use CSS (GPU-accelerated)

## File Locations

- Theme Context: `/lib/theme-context.tsx`
- Theme Toggle: `/components/ThemeToggle.tsx`
- Global Styles: `/app/globals.css`
- Root Layout: `/app/layout.tsx`
- Dashboard Layout: `/app/dashboard/layout.tsx`
- Homepage: `/app/page.tsx`

## Troubleshooting

**Flash of wrong theme on page load:**
- Check that inline script in `app/layout.tsx` is present and runs BEFORE React
- Verify localStorage key is `"theme-preference"`

**Dark mode not persisting:**
- Check browser localStorage (DevTools > Application > Storage > Local Storage)
- Verify Supabase sync if authenticated user
- Check browser privacy settings aren't blocking localStorage

**Colors look off in dark mode:**
- Verify CSS variables in `app/globals.css` are correct
- Test contrast ratio with DevTools color picker
- Check that Tailwind dark: classes are applied

**Toggle not appearing:**
- Verify `ThemeToggle` component is imported in dashboard layout
- Check that component is positioned correctly in topbar
- Verify `useTheme()` hook is accessible (inside `ThemeProvider`)

## Related Resources

- Next.js Dark Mode: https://nextjs.org/docs/app/building-your-application/styling/dark-mode
- TailwindCSS Dark Mode: https://tailwindcss.com/docs/dark-mode
- WCAG Color Contrast: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
