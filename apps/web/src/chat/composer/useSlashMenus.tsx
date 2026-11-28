// The composer's slash commands and skills: the menus shown while « /name » is typed (↑/↓, Entrée or Tab, Échap),
// running a command, the skills asked by /use for the next message (pills), and the note when one cannot run.
import type { KeyboardEvent, RefObject } from 'react';
import { useId, useState } from 'react';
import { cx } from '../../components/ui';
import { t } from '../../i18n';
import { matchCommands, matchSkills, parseCommand, type Command, type CommandName } from '../commands';

export type SlashMenus = ReturnType<typeof useSlashMenus>;

export function useSlashMenus({ text, setText, sending, setSending, disabled, commands, onCommand, skillNames, textarea: ref }: {
  text: string;
  setText: (text: string | ((str: string) => string)) => void;
  sending: boolean;
  setSending: (on: boolean) => void;
  disabled?: boolean;
  commands?: Command[];
  onCommand?: (name: CommandName, arg: string) => Promise<boolean>;
  skillNames?: string[];
  /** the message field */
  textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  // slash menu: highlighted line, text for which Échap closed it, why the last command could not run
  const [pick, setPick] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [commandNote, setCommandNote] = useState<string | null>(null);
  // skills asked by /use for the next message (3 at most)
  const [skills, setSkills] = useState<string[]>([]);

  const menu = commands && onCommand && !disabled && !sending && closedFor !== text ? matchCommands(text, commands) : null;
  const skillMenu = !menu && skillNames && !disabled && !sending && closedFor !== text ? matchSkills(text, skillNames) : null;
  // the field keeps the focus: it names the open list and the highlighted option (aria-controls / aria-activedescendant)
  const uid = useId();
  const pickedSkill = skillMenu ? skillMenu[Math.min(pick, skillMenu.length - 1)]! : null;
  const addSkill = (name: string) => {
    if (skills.includes(name)) { edit(''); return; }
    if (skills.length >= 3) { setCommandNote(t('3 skills au plus par message')); return; }
    setSkills([...skills, name]);
    edit('');
    ref.current?.focus();
  };
  const picked = menu ? menu[Math.min(pick, menu.length - 1)]! : null;
  const edit = (str: string) => { setText(str); setPick(0); setCommandNote(null); };
  /** Runs the command written in the text; false = the text is an ordinary message. */
  const runCommand = async (): Promise<boolean> => {
    if (!commands || !onCommand || sending) return false;
    const found = parseCommand(text, commands);
    if (!found) return false;
    // /use <skill> stays in the composer: a pill for the next message
    if (found.command.name === 'use' && !found.command.disabled) {
      if (skillNames?.includes(found.arg)) addSkill(found.arg);
      else setCommandNote(found.arg ? t('Skill inconnu ou désactivé : {name}', { name: found.arg }) : t('Écrivez le nom du skill après /use'));
      return true;
    }
    if (found.command.disabled) { setCommandNote(t('/{name} : {reason}', { name: found.command.name, reason: found.command.disabled })); return true; }
    const sentText = text;
    setSending(true);
    const ok = await onCommand(found.command.name, found.arg).catch(() => false);
    setSending(false);
    if (ok) setText((str) => (str === sentText ? '' : str));
    return true;
  };
  const choose = async (c: Command) => {
    if (sending) return;
    // a command with an argument: its name goes in the text, the user goes on typing
    if (c.args) { edit(`/${c.name} `); ref.current?.focus(); return; }
    setText(`/${c.name}`);
    if (c.disabled) { setCommandNote(t('/{name} : {reason}', { name: c.name, reason: c.disabled })); setClosedFor(`/${c.name}`); return; }
    setSending(true);
    const ok = await onCommand!(c.name, '').catch(() => false);
    setSending(false);
    setText((str) => (ok && str === `/${c.name}` ? '' : str));
  };
  /** The keys of an open menu in the message field; true = handled (the field does nothing more with it). */
  const onMenuKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (menu && picked) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = menu.indexOf(picked) + (e.key === 'ArrowDown' ? 1 : -1);
        setPick((i + menu.length) % menu.length);
        return true;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); void choose(picked); return true; }
      if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); return true; }
    }
    if (skillMenu && pickedSkill) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = skillMenu.indexOf(pickedSkill) + (e.key === 'ArrowDown' ? 1 : -1);
        setPick((i + skillMenu.length) % skillMenu.length);
        return true;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); addSkill(pickedSkill); return true; }
      if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); return true; }
    }
    return false;
  };

  const listId = skillMenu ? `${uid}-skills` : menu ? `${uid}-commands` : undefined;
  // by position: a skill name is not always a valid id
  const activeId = skillMenu && pickedSkill ? `${uid}-skill-${skillMenu.indexOf(pickedSkill)}` : picked ? `${uid}-command-${picked.name}` : undefined;

  return { menu, picked, listId, activeId, uid, skillMenu, pickedSkill, setPick, skills, setSkills, commandNote, edit, addSkill, runCommand, choose, onMenuKey };
}

/** The two menus above the message field: skills (after « /use ») and commands. */
export function SlashMenuLists({ menus }: { menus: Pick<SlashMenus, 'uid' | 'menu' | 'picked' | 'skillMenu' | 'pickedSkill' | 'setPick' | 'addSkill' | 'choose'> }) {
  const { uid, menu, picked, skillMenu, pickedSkill, setPick, addSkill, choose } = menus;
  return (
    <>
      {skillMenu && (
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox driven from the message field (focus stays there; aria-controls / aria-activedescendant point at it)
        <ul id={`${uid}-skills`} role="listbox" aria-label="Skills" data-skills className="mb-1 max-h-64 overflow-y-auto border-b border-line px-1 pb-1">
          {skillMenu.map((name, i) => (
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option of the listbox above, chosen with the keys typed in the message field
            // biome-ignore lint/a11y/useFocusableInteractive: the option never takes focus; the field exposes it through aria-activedescendant
            <li key={name} id={`${uid}-skill-${i}`} role="option" aria-selected={name === pickedSkill}
              onMouseDown={(e) => { e.preventDefault(); addSkill(name); }}
              onMouseEnter={() => setPick(skillMenu.indexOf(name))}
              className={cx('flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 font-mono text-[13px]', name === pickedSkill && 'bg-raised')}>
              {name}
            </li>
          ))}
        </ul>
      )}
      {menu && (
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox driven from the message field (focus stays there; aria-controls / aria-activedescendant point at it)
        <ul id={`${uid}-commands`} role="listbox" aria-label={t('Commandes')} data-commands className="mb-1 max-h-64 overflow-y-auto border-b border-line px-1 pb-1">
          {menu.map((c) => (
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option of the listbox above, chosen with the keys typed in the message field
            // biome-ignore lint/a11y/useFocusableInteractive: the option never takes focus; the field exposes it through aria-activedescendant
            <li key={c.name} id={`${uid}-command-${c.name}`} role="option" aria-selected={c === picked} aria-disabled={Boolean(c.disabled)}
              onMouseDown={(e) => { e.preventDefault(); void choose(c); }}
              onMouseEnter={() => setPick(menu.indexOf(c))}
              title={c.disabled}
              className={cx('flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-sm', c === picked && 'bg-raised', c.disabled && 'opacity-50')}>
              <span className="font-mono text-[13px]">/{c.name}{c.args ? <span className="text-ink-faint"> {c.args}</span> : null}</span>
              <span className="truncate text-ink-soft">{c.label}</span>
              {c.disabled && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{c.disabled}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
