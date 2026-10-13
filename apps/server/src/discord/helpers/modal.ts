/** What `showModal` needs from an interaction; structural for the reason given in `reply.ts`. */
type ModalTarget<Modal> = {
  readonly replied: boolean;
  readonly deferred: boolean;
  showModal(modal: Modal): Promise<unknown>;
};

/**
 * Opens a modal as the interaction's first response. Discord only accepts a
 * modal as the initial reply, and the interaction must be answered within 3
 * seconds, so any slow lookup belongs after the modal is submitted. Throws
 * rather than let Discord refuse with an opaque "already acknowledged".
 */
export async function showModalFirst<Modal>(
  interaction: ModalTarget<Modal>,
  modal: Modal,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    throw new Error('A modal must be the first response to an interaction');
  }
  await interaction.showModal(modal);
}
