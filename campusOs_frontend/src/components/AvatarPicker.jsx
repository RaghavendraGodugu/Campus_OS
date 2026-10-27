import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageOff, Trash2 } from "lucide-react";

import { apiAssetUrl, apiDelete, apiUpload } from "../api/client";
import Button from "./ui/Button";

/**
 * Profile picture.
 *
 * ## The preview comes from the local File
 *
 * The officer sees the picture before it is uploaded, because they have the File
 * already. Uploading first and rendering afterwards would mean a round trip
 * before any confirmation that the right image was chosen.
 *
 * ## The object URL is revoked when it is replaced, not on unmount
 *
 * Revoking on unmount looks tidier and is wrong. React's StrictMode mounts,
 * unmounts and remounts every component in development, so an unmount cleanup
 * revokes the URL immediately and the image silently stops rendering. One blob
 * may outlive the page by a little; the browser reclaims it when the document
 * goes.
 */

/** The API caps avatars at 2 MB. Checking here saves a wasted upload. */
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export default function AvatarPicker({ userId, hasAvatar, onChange }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);

  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const previewRef = useRef(null);

  useEffect(() => {
    if (previewRef.current && previewRef.current !== preview) {
      URL.revokeObjectURL(previewRef.current);
    }
    previewRef.current = preview;
  }, [preview]);

  const upload = useMutation({
    mutationFn: (file) =>
      apiUpload("/profile/avatar", { field: "avatar", file }),
    onSuccess: () => {
      // The profile holds `hasAvatar`, and the top bar holds the picture.
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setPreview(null);
      setError(null);
      onChange?.();
    },
    onError: (caught) =>
      setError(caught?.message ?? "The picture could not be uploaded."),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete("/profile/avatar"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setPreview(null);
      setError(null);
      onChange?.();
    },
    onError: (caught) =>
      setError(caught?.message ?? "The picture could not be removed."),
  });

  const choose = (event) => {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        "That image is over 2 MB. A photo is usually enough — resize it first.",
      );
      event.target.value = "";
      return;
    }

    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  };

  const src =
    preview ?? (hasAvatar ? apiAssetUrl(`/profile/avatar/${userId}`) : null);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        {src ? (
          <img
            src={src}
            alt="Your profile picture"
            className="size-16 rounded-2xl object-cover ring-1 ring-ink-200 dark:ring-ink-600"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid size-16 place-items-center rounded-2xl bg-ink-100 text-lg font-semibold text-ink-500 dark:bg-ink-200/50 dark:text-ink-400"
          >
            {initials}
          </div>
        )}

        {upload.isPending && (
          <span
            className="absolute inset-0 grid place-items-center rounded-2xl bg-ink-900/45 text-xs font-medium text-white"
            role="status"
          >
            Saving…
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending || remove.isPending}
          >
            <Camera className="size-4" aria-hidden="true" />
            {hasAvatar ? "Change picture" : "Add a picture"}
          </Button>

          {(hasAvatar || preview) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={upload.isPending || remove.isPending}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </Button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            onChange={choose}
            className="sr-only"
            aria-label="Choose a profile picture"
          />
        </div>

        <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
          JPEG, PNG or WebP, up to 2 MB. Only you and signed-in colleagues can
          see it.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-1.5 flex items-center gap-1.5 text-xs text-red-700 dark:text-red-300"
          >
            <ImageOff className="size-3.5" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Fallback monogram, so an account without a picture still reads as a person. */
function initials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return (
    parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}
