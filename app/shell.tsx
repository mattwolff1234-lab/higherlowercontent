import Link from "next/link";
import { InfoIcon, LogoIcon, PlayNavIcon, SendIcon } from "./icons";
import { SIDESHIFT_URL } from "@/lib/site";

// The app frame, modelled on the SideShift dashboard: an icon rail on the left
// and a white rounded panel holding the page.
export default function Shell({
  active,
  children,
}: {
  active: "play" | "about";
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh">
      <aside className="hidden w-[88px] shrink-0 flex-col items-center gap-5 py-4 md:flex">
        <Link href="/" aria-label="Home" className="metal mb-3 flex h-11 w-11 items-center justify-center">
          <LogoIcon className="h-5 w-5" />
        </Link>
        <NavItem href="/" label="Play" active={active === "play"}>
          <PlayNavIcon />
        </NavItem>
        <NavItem href="/about" label="About" active={active === "about"}>
          <InfoIcon />
        </NavItem>
        <NavItem href={SIDESHIFT_URL} label="SideShift" external>
          <SendIcon />
        </NavItem>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white md:my-2 md:mr-2 md:rounded-xl md:border md:border-[#7070701f] md:shadow-[0_2px_3px_#6865650a]">
        {children}
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  active = false,
  external = false,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  external?: boolean;
  children: React.ReactNode;
}) {
  const tile = active
    ? "metal-light text-neutral-900"
    : "text-neutral-500 group-hover:text-neutral-900";
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="group flex flex-col items-center gap-1"
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tile}`}>
        {children}
      </span>
      <span className={`text-xs ${active ? "font-medium text-neutral-900" : "text-neutral-500"}`}>
        {label}
      </span>
    </Link>
  );
}
