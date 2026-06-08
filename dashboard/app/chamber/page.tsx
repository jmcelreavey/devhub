/**
 * The /chamber route exists so the URL and sidebar link work, but the actual
 * iframe is rendered by <PersistentChamber> in the root layout so it survives
 * client-side navigation to other pages.
 */
export default function ChamberPage() {
  return null;
}
