'use client';

import Thumbnail from '@/components/Thumbnail';
import FormattedDateTime from '@/components/FormattedDateTime';
import { convertFileSize, formatDateTime } from '@/lib/utils';
import {
  defaultSharePermissions,
  normalizeSharePermissions,
  sharePrivileges,
} from '@/constants';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

const ImageThumbnail = ({ file }: { file: FileDocument }) => (
  <div className="file-details-thumbnail">
    <Thumbnail type={file.type} extension={file.extension} url={file.url} />
    <div className="flex flex-col">
      <p className="subtitle-2 mb-1">{file.name}</p>
      <FormattedDateTime date={file.$createdAt} className="caption" />
    </div>
  </div>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex">
    <p className="file-details-label text-left">{label}</p>
    <p className="file-details-value text-left">{value}</p>
  </div>
);

export const FileDetails = ({ file }: { file: FileDocument }) => {
  return (
    <>
      <ImageThumbnail file={file} />
      <div className="space-y-4 px-2 pt-2">
        <DetailRow label="Format:" value={file.extension} />
        <DetailRow label="Size:" value={convertFileSize(file.size)} />
        <DetailRow label="Owner:" value={file.owner.fullName} />
        <DetailRow label="Last edit:" value={formatDateTime(file.$updatedAt)} />
      </div>
    </>
  );
};

const PrivilegeToggles = ({
  value,
  onChange,
  disabled = false,
}: {
  value: SharePrivilege[];
  onChange: (permissions: SharePrivilege[]) => void;
  disabled?: boolean;
}) => (
  <ul className="share-privileges">
    {sharePrivileges.map((privilege) => {
      const locked = 'required' in privilege && privilege.required;
      const on = locked || value.includes(privilege.key);

      return (
        <li key={privilege.key} className="share-privilege">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={privilege.label}
            disabled={disabled || locked}
            className={`share-switch${on ? ' share-switch-on' : ''}${
              locked ? ' share-switch-locked' : ''
            }`}
            onClick={() => {
              if (locked) return;

              const next = on
                ? value.filter((key) => key !== privilege.key)
                : [...value, privilege.key];

              onChange(normalizeSharePermissions(next));
            }}
          >
            <span className="share-switch-thumb" />
          </button>
          <div className="min-w-0 text-left">
            <p className="subtitle-2 text-light-100">{privilege.label}</p>
            <p className="caption text-light-200">{privilege.description}</p>
          </div>
        </li>
      );
    })}
  </ul>
);

const privilegeSummary = (permissions: readonly string[]) => {
  const extras = sharePrivileges
    .filter(
      (privilege) =>
        !('required' in privilege) && permissions.includes(privilege.key),
    )
    .map((privilege) => privilege.label);

  return extras.length ? `View, ${extras.join(', ')}` : 'View';
};

type ShareAnchor = 'draft' | string;

export const ShareInput = ({
  file,
  recipients,
  draft,
  draftPermissions,
  onDraftChange,
  onDraftPermissionsChange,
  onPermissionsChange,
  onRemove,
  onCancel,
  onShare,
  busy = false,
}: ActionsModalContentProps) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const draftRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState<ShareAnchor | null>(null);
  const [line, setLine] = useState<{
    width: number;
    height: number;
    d: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const activePerson =
    active && active !== 'draft'
      ? recipients.find((person) => person.email === active)
      : null;

  useEffect(() => {
    if (active && active !== 'draft' && !activePerson) setActive(null);
  }, [active, activePerson]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    const detail = detailRef.current;
    const card = board?.querySelector('.share-card');

    // Drop the curve before the browser paints a closed panel. Otherwise the
    // previous path stays on screen for the whole close animation.
    if (!active) {
      setLine(null);
      return;
    }

    const measure = () => {
      if (!board || !detail || !card || window.innerWidth < 860) {
        setLine(null);
        return;
      }

      const anchor =
        active === 'draft'
          ? draftRef.current
          : rowRefs.current.get(active) ?? null;

      if (!anchor) {
        setLine(null);
        return;
      }

      const boardBox = board.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      const detailBox = detail.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();

      const x1 = anchorBox.right - boardBox.left;
      const y1 = anchorBox.top + anchorBox.height / 2 - boardBox.top;
      const x2 = detailBox.left - boardBox.left;
      const y2 = detailBox.top + detailBox.height / 2 - boardBox.top;
      const cardRight = cardBox.right - boardBox.left;

      // The side card starts on top of this dialog and slides right.
      // A curve before it has cleared the card cuts across the list,
      // and that same curve is what was left behind after Back.
      if (detailBox.width < 40 || x2 < cardRight + 20) {
        setLine(null);
        return;
      }

      const bend = Math.max(28, (x2 - x1) * 0.45);

      setLine({
        width: boardBox.width,
        height: boardBox.height,
        x1,
        y1,
        x2,
        y2,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      });
    };

    let frame = 0;
    const started = performance.now();
    const follow = () => {
      measure();
      if (performance.now() - started < 560) {
        frame = requestAnimationFrame(follow);
      }
    };

    frame = requestAnimationFrame(follow);
    const list = listRef.current;
    list?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(frame);
      list?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [active, recipients, draftPermissions, busy]);

  const openAccess = (anchor: ShareAnchor) => {
    // Clear first so the curve cannot outlive the panel, or appear while
    // the panel is still travelling out of the dialog.
    setLine(null);
    setActive((current) => (current === anchor ? null : anchor));
  };

  const detailPermissions =
    active === 'draft'
      ? draftPermissions
      : (activePerson?.permissions ?? defaultSharePermissions);

  return (
    <div
      ref={boardRef}
      className={`share-board${active ? ' is-linked' : ''}`}
    >
      <section className="share-card">
        <DialogTitle className="h3 text-center text-[20px] font-semibold leading-[28px] tracking-normal text-light-100">
          Share
        </DialogTitle>
        <ImageThumbnail file={file} />

        <div className="share-wrapper">
          <p className="subtitle-2 pl-1 text-light-100">
            Share file with other users
          </p>
          <Input
            type="text"
            inputMode="email"
            placeholder="Enter email address"
            value={draft}
            // Controlled so a successful share can clear the field while the
            // dialog stays open for the next address.
            onChange={(event) => onDraftChange(event.target.value)}
            className="share-input-field"
            disabled={busy}
          />
          <button
            ref={draftRef}
            type="button"
            className={`share-row-open${active === 'draft' ? ' is-active' : ''}`}
            aria-expanded={active === 'draft'}
            onClick={() => openAccess('draft')}
          >
            <span className="subtitle-2 text-light-100">Privileges</span>
            <span className="caption text-brand">
              {privilegeSummary(draftPermissions)}
            </span>
          </button>

          <div className="flex justify-between pt-3">
            <p className="subtitle-2 text-light-100">Shared with</p>
            <p className="subtitle-2 text-light-200">
              {recipients.length} users
            </p>
          </div>
          <ul ref={listRef} className="share-people">
            {recipients.map((person) => (
              <li key={person.email} className="share-row">
                <button
                  type="button"
                  ref={(node) => {
                    if (node) rowRefs.current.set(person.email, node);
                    else rowRefs.current.delete(person.email);
                  }}
                  className={`share-row-open${
                    active === person.email ? ' is-active' : ''
                  }`}
                  aria-expanded={active === person.email}
                  onClick={() => openAccess(person.email)}
                >
                  <span className="subtitle-2 min-w-0 flex-1 truncate text-left text-light-100">
                    {person.email}
                  </span>
                  <span className="caption shrink-0 text-brand">
                    {privilegeSummary(person.permissions)}
                  </span>
                </button>
                <Button
                  type="button"
                  onClick={() => {
                    if (active === person.email) {
                      setLine(null);
                      setActive(null);
                    }
                    onRemove(person.email);
                  }}
                  className="share-remove-user"
                  disabled={busy}
                >
                  <Image
                    src="/assets/icons/remove.svg"
                    alt="Remove"
                    width={24}
                    height={24}
                    className="remove-icon"
                  />
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={onCancel} className="modal-cancel-button">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onShare}
            className="modal-submit-button"
            disabled={busy}
          >
            <p>Share</p>
            {busy && (
              <Image
                src="/assets/icons/loader.svg"
                alt=""
                width={24}
                height={24}
                className="animate-spin"
              />
            )}
          </Button>
        </div>
      </section>

      <div className="share-gap" aria-hidden />

      <section
        ref={detailRef}
        className="share-detail"
        aria-hidden={!active}
        inert={!active}
        {...(active ? { 'aria-label': 'Privileges' } : {})}
      >
        <button
          type="button"
          className="share-detail-back"
          onClick={() => {
            setLine(null);
            setActive(null);
          }}
        >
          Back
        </button>
        <p className="caption text-brand">Access</p>
        <h3 className="subtitle-1 truncate text-light-100">
          {active === 'draft' ? draft.trim() || 'New address' : active}
        </h3>
        <p className="caption mb-2 text-light-200">
          Turn on what this person can do. View stays on.
        </p>
        <PrivilegeToggles
          value={detailPermissions}
          disabled={busy || !active}
          onChange={(permissions) => {
            if (active === 'draft') onDraftPermissionsChange(permissions);
            else if (active) onPermissionsChange(active, permissions);
          }}
        />
      </section>

      <Connector active={active} line={line} />
    </div>
  );
};

const Connector = ({
  active,
  line,
}: {
  active: string | null;
  line: {
    width: number;
    height: number;
    d: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null;
}) => {
  if (!active || !line) return null;

  return (
    <svg
      className="share-connector"
      width={line.width}
      height={line.height}
      aria-hidden
    >
      <path
        key={active}
        d={line.d}
        pathLength={1}
        className="share-connector-path"
      />
      <circle className="share-connector-node" cx={line.x1} cy={line.y1} r="4" />
      <circle className="share-connector-node" cx={line.x2} cy={line.y2} r="4" />
    </svg>
  );
};

// Details stays a single card unless the owner has shared the file.
// Then "Shared with" opens the same side panel as access on Share, read-only.
export const DetailsWithAccess = ({ file }: { file: FileDocument }) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState<{
    width: number;
    height: number;
    d: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  useLayoutEffect(() => {
    const board = boardRef.current;
    const detail = detailRef.current;
    const card = board?.querySelector('.share-card');

    if (!open) {
      setLine(null);
      return;
    }

    const measure = () => {
      const anchor = anchorRef.current;

      if (!board || !detail || !card || !anchor || window.innerWidth < 860) {
        setLine(null);
        return;
      }

      const boardBox = board.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      const detailBox = detail.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const x1 = anchorBox.right - boardBox.left;
      const y1 = anchorBox.top + anchorBox.height / 2 - boardBox.top;
      const x2 = detailBox.left - boardBox.left;
      const y2 = detailBox.top + detailBox.height / 2 - boardBox.top;
      const cardRight = cardBox.right - boardBox.left;

      if (detailBox.width < 40 || x2 < cardRight + 20) {
        setLine(null);
        return;
      }

      const bend = Math.max(28, (x2 - x1) * 0.45);

      setLine({
        width: boardBox.width,
        height: boardBox.height,
        x1,
        y1,
        x2,
        y2,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      });
    };

    let frame = 0;
    const started = performance.now();
    const follow = () => {
      measure();
      if (performance.now() - started < 560) frame = requestAnimationFrame(follow);
    };

    frame = requestAnimationFrame(follow);
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [open, file.shares]);

  return (
    <div ref={boardRef} className={`share-board${open ? ' is-linked' : ''}`}>
      <section className="share-card">
        <DialogTitle className="h3 text-center text-[20px] font-semibold leading-[28px] tracking-normal text-light-100">
          Details
        </DialogTitle>
        <FileDetails file={file} />
        <button
          ref={anchorRef}
          type="button"
          className={`share-row-open mt-4${open ? ' is-active' : ''}`}
          aria-expanded={open}
          onClick={() => {
            setLine(null);
            setOpen((current) => !current);
          }}
        >
          <span className="subtitle-2 text-light-100">Shared with</span>
          <span className="caption text-brand">
            {file.shares.length} {file.shares.length === 1 ? 'person' : 'people'}
          </span>
        </button>
      </section>

      <div className="share-gap" aria-hidden />

      <section
        ref={detailRef}
        className="share-detail"
        aria-hidden={!open}
        inert={!open}
        {...(open ? { 'aria-label': 'People with access' } : {})}
      >
        <button
          type="button"
          className="share-detail-back"
          onClick={() => {
            setLine(null);
            setOpen(false);
          }}
        >
          Back
        </button>
        <p className="caption text-brand">Access</p>
        <h3 className="subtitle-1 text-light-100">People with this file</h3>
        <p className="caption mb-3 text-light-200">
          Change what they can do from Share.
        </p>
        <ul className="share-people">
          {file.shares.map((person) => (
            <li key={person.email} className="share-row">
              <div className="share-row-open">
                <span className="subtitle-2 min-w-0 flex-1 truncate text-left text-light-100">
                  {person.email}
                </span>
                <span className="caption shrink-0 text-brand">
                  {privilegeSummary(person.permissions)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Connector active={open ? 'access' : null} line={line} />
    </div>
  );
};
