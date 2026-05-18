import { ConfirmModal } from "./ConfirmModal";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function GreenfieldWarningModal({ open, onConfirm, onClose }: Props) {
  return (
    <ConfirmModal
      open={open}
      title="Sem repositório GitHub"
      message={
        "Você não escolheu um repositório. Os artefatos serão gerados em modo " +
        "greenfield — o agente não terá acesso a código existente como referência. " +
        "Volte e configure o GitHub se quiser que os artefatos considerem o código atual."
      }
      confirmLabel="Seguir greenfield"
      cancelLabel="Voltar"
      intent="primary"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
