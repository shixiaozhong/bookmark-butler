export function isMacPlatform(platform) {
  return /mac/i.test(platform);
}

/**
 * The shortcut list, written for the keys printed on this computer's keyboard.
 * Each entry's `keys` are pressed together, or typed in turn when `inTurn` is set.
 */
export function shortcutGroups(isMac) {
  const command = isMac ? '⌘' : 'Ctrl';
  const option = isMac ? '⌥' : 'Alt';
  const backspace = isMac ? 'Delete' : 'Backspace';
  return [
    {
      title: '搜索',
      items: [
        { keys: ['回车'], action: '打开第一条结果' },
        { keys: ['↓'], action: '从搜索框进入列表' },
      ],
    },
    {
      title: '浏览和整理',
      items: [
        { keys: ['方向键'], action: '在图标之间移动' },
        { keys: ['回车'], action: '打开书签或进入文件夹' },
        { keys: [backspace], action: '返回上一层' },
        { keys: [command, '点击'], action: '在后台打开书签' },
        { keys: [option, '方向键'], action: '调整图标的位置' },
      ],
    },
    {
      title: '多选模式',
      items: [
        { keys: ['空格'], action: '勾选或取消勾选' },
        { keys: ['Shift', '点击'], action: '连续选择' },
        { keys: ['Esc'], action: '退出多选' },
      ],
    },
    {
      title: '其他',
      items: [
        { keys: ['b', '空格', '关键词'], inTurn: true, action: '在地址栏搜索书签' },
        { keys: ['?'], action: '打开这份说明' },
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
