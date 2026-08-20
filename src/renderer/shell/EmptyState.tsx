type Props = {
  image: string;
  title: string;
  hint?: string;
};

export function EmptyState({ image, title, hint }: Props) {
  return (
    <div className="empty-state">
      <img className="empty-state-image" src={image} alt="" draggable={false} />
      <div className="empty-state-copy">
        <div className="empty-state-title">{title}</div>
        {hint ? <div className="empty-state-hint">{hint}</div> : null}
      </div>
    </div>
  );
}
