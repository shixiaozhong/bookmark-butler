export function isMacPlatform(platform) {
  return /mac/i.test(platform);
}

/**
 * The shortcut list, written for the keys printed on this computer's keyboard.
 * Text comes through `t`, so this stays testable outside the browser.
 * Each entry's `keys` are pressed together, or typed in turn when `inTurn` is set.
 */
export function shortcutGroups(isMac, t) {
  const command = isMac ? '⌘' : 'Ctrl';
  const option = isMac ? '⌥' : 'Alt';
  const backspace = isMac ? 'Delete' : 'Backspace';
  return [
    {
      title: t('shortcuts_group_search'),
      items: [
        { keys: [t('key_enter')], action: t('shortcut_open_first') },
        { keys: ['↓'], action: t('shortcut_enter_list') },
      ],
    },
    {
      title: t('shortcuts_group_browse'),
      items: [
        { keys: [t('key_arrows')], action: t('shortcut_move_focus') },
        { keys: [t('key_enter')], action: t('shortcut_open') },
        { keys: [backspace], action: t('shortcut_go_up') },
        { keys: [command, t('key_click')], action: t('shortcut_background') },
        { keys: [option, t('key_arrows')], action: t('shortcut_reorder') },
      ],
    },
    {
      title: t('shortcuts_group_select'),
      items: [
        { keys: [t('key_space')], action: t('shortcut_toggle') },
        { keys: ['Shift', t('key_click')], action: t('shortcut_range') },
        { keys: ['Esc'], action: t('shortcut_exit_select') },
      ],
    },
    {
      title: t('shortcuts_group_other'),
      items: [
        { keys: ['b', t('key_space'), t('key_keywords')], inTurn: true, action: t('shortcut_address_bar') },
        { keys: ['?'], action: t('shortcut_help') },
      ],
    },
  ];
}

/**
 * Whether a key press should open the shortcut list. `?` has to stay typeable, so
 * it's only taken from the search box while that's empty, which matters because
 * the search box has focus whenever the popup opens.
 */
export function opensShortcutHelp(event, { editing, emptySearch, dialogOpen }) {
  if (event.key !== '?' && event.key !== '？') return false;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || dialogOpen) return false;
  return !editing || emptySearch;
}
