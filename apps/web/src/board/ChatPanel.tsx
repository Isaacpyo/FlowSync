import { LIMITS } from '@flowsync/shared';
import clsx from 'clsx';
import { MessagesSquare, RotateCcw, Send } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, Spinner } from '../components/ui';
import { clockTime } from '../lib/time';
import { boardActions, useBoard } from '../sync/board-store';

export function ChatPanel() {
  const chat = useBoard((s) => s.chat);
  const me = useBoard((s) => s.me);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const typingSent = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep the newest message in view unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  function setTyping(typing: boolean) {
    if (typingSent.current !== typing) {
      typingSent.current = typing;
      boardActions.typing(typing);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    boardActions.sendMessage(body);
    setDraft('');
    setTyping(false);
    stickToBottom.current = true;
  }

  const typingNames = Object.entries(chat.typing)
    .filter(([id]) => id !== me?.id)
    .map(([, t]) => t.name);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol
        ref={list}
        aria-label="Chat messages"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {chat.nextCursor && (
          <li className="text-center">
            <button
              type="button"
              onClick={() => void boardActions.loadMessages(true)}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Load earlier messages
            </button>
          </li>
        )}
        {!chat.loaded && chat.loading && (
          <li className="flex justify-center py-6">
            <Spinner label="Loading messages" />
          </li>
        )}
        {chat.loaded && chat.messages.length === 0 && (
          <li className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            <MessagesSquare className="size-6" aria-hidden />
            No messages yet. Say hi to the team!
          </li>
        )}
        {chat.messages.map((m) => {
          const mine = m.author?.id === me?.id;
          return (
            <li key={m.clientId ?? m.id} className={clsx('flex gap-2', mine && 'flex-row-reverse')}>
              <Avatar
                name={m.author?.name ?? 'Former guest'}
                color={m.author?.avatarColor ?? '#94a3b8'}
                size="xs"
                className="mt-5"
              />
              <div className={clsx('max-w-[80%]', mine && 'text-right')}>
                <p className="mb-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {mine ? 'You' : (m.author?.name ?? 'Former guest')} · {clockTime(m.createdAt)}
                </p>
                <p
                  className={clsx(
                    'inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm',
                    mine
                      ? 'rounded-tr-sm bg-brand-600 text-white dark:bg-brand-500'
                      : 'rounded-tl-sm bg-slate-100 dark:bg-slate-800',
                    m.status === 'sending' && 'opacity-60',
                  )}
                >
                  {m.body}
                </p>
                {m.status === 'failed' && (
                  <button
                    type="button"
                    onClick={() => boardActions.sendMessage(m.body, m)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    <RotateCcw className="size-3" aria-hidden /> Not sent. Retry
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="h-5 px-4 text-xs italic text-slate-500 dark:text-slate-400" aria-live="polite">
        {typingNames.length > 0 &&
          `${typingNames.slice(0, 2).join(' and ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`}
      </p>
      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
      >
        <label htmlFor="chat-input" className="sr-only">
          Message the team
        </label>
        <textarea
          id="chat-input"
          rows={1}
          value={draft}
          maxLength={LIMITS.chatMessage}
          placeholder="Message the team…"
          onChange={(e) => {
            setDraft(e.target.value);
            setTyping(e.target.value.length > 0);
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setTyping(false), 3_000);
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim()}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 dark:bg-brand-500"
        >
          <Send className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
