"use client";

import { NewVaultPathModal, type NewVaultPathModalProps } from "@/components/NewVaultPathModal";

export type NewNotePathModalProps = Omit<NewVaultPathModalProps, "vault">;

/** Wrapper around {@link NewVaultPathModal} for notes. */
export function NewNotePathModal(props: NewNotePathModalProps) {
  return <NewVaultPathModal vault="notes" {...props} />;
}
