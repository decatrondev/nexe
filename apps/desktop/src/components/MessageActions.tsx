/** Hover action bar that appears on message hover */

interface MessageActionsProps {
  messageId: string;
  authorId: string;
  currentUserId?: string;
  canManageMessages: boolean;
  onReaction: (e: React.MouseEvent, messageId: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MessageActions({
  authorId,
  currentUserId,
  canManageMessages,
  onReaction,
  onReply,
  onEdit,
  onDelete,
  messageId,
}: MessageActionsProps) {
  const isOwn = authorId !== "" && authorId === currentUserId;

  return (
    <div className="absolute -top-3 right-2 hidden gap-0.5 rounded border border-dark-700 bg-dark-900 p-0.5 shadow-lg group-hover:flex animate-fade-in">
      <button
        onClick={(e) => onReaction(e, messageId)}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
        title="Add Reaction"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      <button
        onClick={onReply}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
        title="Reply"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>
      {isOwn && (
        <button
          onClick={onEdit}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
          title="Edit"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}
      {(isOwn || canManageMessages) && (
        <button
          onClick={onDelete}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
          title="Delete"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}
