import { revalidatePath } from "next/cache";

/**
 * Drops the cached storefront pages after a catalogue write.
 *
 * `/` is ISR with a 60s window (`export const revalidate = 60` in
 * `src/app/page.tsx`), so a product edit would otherwise take up to a minute to
 * appear.
 *
 * `/preorder/[slug]` renders on demand, so it has no window to wait for - the
 * call there is about the router cache: it marks the path stale so a visitor who
 * already has that page cached in their browser fetches it again instead of
 * reusing the pre-edit payload. The whole route is invalidated rather than
 * trying to guess which slugs a colour image belongs to.
 */
export function revalidateStorefront(): void {
  revalidatePath("/");
  revalidatePath("/preorder/[slug]", "page");
}
