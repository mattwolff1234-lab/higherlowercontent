import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `About | ${SITE_NAME}` };

export default function About() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-12 text-neutral-600">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        &larr; Back to the game
      </Link>
      <h1 className="text-2xl font-bold text-neutral-900">About {SITE_NAME}</h1>
      <p>
        You see two short videos from TikTok or Instagram and the follower count of each
        creator. Pick the one you think has more views. Keep going until you get one wrong.
      </p>
      <p>
        Videos are public posts and every one is credited to its creator, with a link to the
        original after each round. View and follower counts are a snapshot from when the video
        was added, so they can differ from what the platform shows today.
      </p>
      <h2 className="text-lg font-semibold text-neutral-900">Want your video removed?</h2>
      <p>
        If you are the creator of a video shown here and want it taken down, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-neutral-900 underline">
          {CONTACT_EMAIL}
        </a>{" "}
        with a link to your post and we will remove it.
      </p>
      <p className="text-sm text-neutral-500">
        This site is not affiliated with TikTok or Instagram.
      </p>
    </main>
  );
}
