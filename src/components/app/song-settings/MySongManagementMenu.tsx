import { useEffect, useRef, useState } from "react";
import { MoreVertical, Music2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { SongRow } from "@/lib/chartRepository";
import { SongTapGesture } from "@/lib/songTapGesture";
export function MySongManagementMenu({
  song,
  selected,
  onSelect,
  onPlay,
  onEdit,
}: {
  song: SongRow;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onEdit: () => void;
}) {
  const gesture = useRef(new SongTapGesture()),
    lastTouch = useRef(-Infinity),
    editing = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => () => gesture.current.reset(), [song.id, song.user_id]);
  useEffect(() => {
    if (!selected) {
      gesture.current.reset();
      setOpen(false);
    }
  }, [selected]);
  return (
    <div
      className={`rounded-xl border p-2 ${selected ? "border-cyan-200/70 bg-cyan-200/10" : "border-transparent bg-black/20"}`}
    >
      <div className="flex min-w-0 items-center">
        <button
          id={`my-song-${song.id}`}
          type="button"
          aria-pressed={selected}
          className="flex min-h-12 min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-lg px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
          onClick={(e) => {
            if (e.detail === 0 || performance.now() - lastTouch.current > 700) onSelect();
          }}
          onDoubleClick={() => {
            if (performance.now() - lastTouch.current > 700) {
              gesture.current.reset();
              onPlay();
            }
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse")
              gesture.current.start(
                e.pointerId,
                e.pointerType,
                e.isPrimary,
                e.clientX,
                e.clientY,
                e.timeStamp,
              );
          }}
          onPointerMove={(e) => gesture.current.move(e.pointerId, e.clientX, e.clientY)}
          onPointerUp={(e) => {
            if (e.pointerType === "mouse") return;
            lastTouch.current = performance.now();
            const action = gesture.current.end(e.pointerId, e.clientX, e.clientY, e.timeStamp);
            if (action !== "none") onSelect();
            if (action === "play") onPlay();
          }}
          onPointerCancel={() => gesture.current.reset()}
          onLostPointerCapture={() => {
            if (gesture.current.active) gesture.current.reset();
          }}
        >
          <Music2 className="size-5 shrink-0 text-cyan-200" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{song.title}</span>
            <span className="block text-xs text-white/50">
              {selected ? "選択中 · " : ""}
              {song.is_published ? "公開中" : "下書き"} · {song.note_count} notes
            </span>
          </span>
        </button>
        <div className="w-11 shrink-0">
          {selected && (
            <DropdownMenu
              open={open}
              onOpenChange={(value) => {
                gesture.current.reset();
                setOpen(value);
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  id={`song-menu-${song.id}`}
                  type="button"
                  className="flex size-11 items-center justify-center rounded-lg hover:bg-white/10"
                  aria-label={`${song.title} の管理メニュー`}
                >
                  <MoreVertical className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                onCloseAutoFocus={(e) => {
                  if (editing.current) e.preventDefault();
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    editing.current = true;
                    gesture.current.reset();
                    window.setTimeout(() => {
                      onEdit();
                      editing.current = false;
                    }, 0);
                  }}
                >
                  編集
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    gesture.current.reset();
                    onPlay();
                  }}
                >
                  プレイ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {selected && (
        <button
          type="button"
          onClick={() => {
            gesture.current.reset();
            onPlay();
          }}
          className="mt-1 min-h-11 w-full rounded-lg border border-cyan-200/20 text-sm text-cyan-100"
        >
          プレイ
        </button>
      )}
    </div>
  );
}
