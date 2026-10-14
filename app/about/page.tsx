import type { Metadata } from "next";
import { CONTACT_EMAIL, SIDESHIFT_URL, SITE_NAME } from "@/lib/site";
import Shell from "../shell";

export const metadata: Metadata = { title: `About | ${SITE_NAME}` };

export default function About() {
  return (
    <Shell active="about">
      <header className="shrink-0 border-b border-[#7070701f] px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold tracking-tight md:text-xl">About</h1>
        <p className="hidden text-sm text-neutral-500 sm:block">How the game works</p>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="flex max-w-2xl flex-col gap-3">
          <section className="panel p-5 text-neutral-600">
            <h2 className="font-semibold text-neutral-900">The game</h2>
            <p className="mt-1">
              You see two short videos from TikTok or Instagram and the follower count of each
              creator. Pick the one you think has more views. Keep going until you get one wrong.
            </p>
          </section>
          <section className="panel p-5 text-neutral-600">
            <h2 className="font-semibold text-neutral-900">The videos</h2>
            <p className="mt-1">
              Videos are public posts and every one is credited to its creator, with a link to the
              original after each round. View and follower counts are a snapshot from when the
              video was added, so they can differ from what the platform shows today.
            </p>
          </section>
          <section className="panel p-5 text-neutral-600">
            <h2 className="font-semibold text-neutral-900">Want your video removed?</h2>
            <p className="mt-1">
              If you are the creator of a video shown here and want it taken down, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-neutral-900 underline">
                {CONTACT_EMAIL}
              </a>{" "}
              with a link to your post and we will remove it.
            </p>
          </section>
          <section className="metal-blue p-5">
            <h2 className="font-semibold">Good at spotting what goes viral?</h2>
            <p className="mt-1 text-white/85">
              Brands on SideShift pay creators to make UGC.
            </p>
            <a
              href={SIDESHIFT_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-neutral-900 hover:bg-white/90"
            >
              Start earning on SideShift
            </a>
          </section>
          <p className="text-sm text-neutral-500">
            This site is not affiliated with TikTok or Instagram.
          </p>
        </div>
      </div>
    </Shell>
  );
}
