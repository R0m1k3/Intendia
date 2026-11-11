import { useState } from 'react';

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false; // storage blocked (private browsing): default state
  }
}

/** A yes/no display preference of this browser, kept in localStorage ("1" = yes, absent = no). */
export function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => read(key));
  const set = (v: boolean) => {
    setValue(v);
    try {
      if (v) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // not kept: the choice lasts until the page is reloaded
    }
  };
  return [value, set];
}
