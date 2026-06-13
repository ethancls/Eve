import Modal from './Modal'

export default function ForbiddenActionModal({
  title = 'Action Not Permitted',
  description = 'Your role does not allow this operation.',
  onClose,
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={<button className="btn-accent" onClick={onClose}>Understood</button>}
    >
      <p className="mono" style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {description}
      </p>
    </Modal>
  )
}
