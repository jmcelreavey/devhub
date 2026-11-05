/** Zsh reads every startup file from ZDOTDIR, including login profiles. */
export function zshStartupFiles(): Record<string, string> {
  const restore = [
    'typeset -g __devhub_zdotdir="$ZDOTDIR"',
    'if [[ "$DEVHUB_USER_ZDOTDIR_SET" == 1 ]]; then',
    '  export ZDOTDIR="$USER_ZDOTDIR"',
    'else',
    '  unset ZDOTDIR',
    'fi',
  ];
  return Object.fromEntries([".zshenv", ".zprofile", ".zshrc"].map(file => [file, [
    ...restore,
    `[[ ! -f "\${ZDOTDIR:-$HOME}/${file}" ]] || source "\${ZDOTDIR:-$HOME}/${file}"`,
    ...(file === ".zshrc" ? [
      'source "${__devhub_zdotdir:h}/hooks.zsh"',
      'unset __devhub_zdotdir USER_ZDOTDIR DEVHUB_USER_ZDOTDIR_SET',
    ] : [
      'export USER_ZDOTDIR="${ZDOTDIR:-$HOME}"',
      'export DEVHUB_USER_ZDOTDIR_SET="${+ZDOTDIR}"',
      'export ZDOTDIR="$__devhub_zdotdir"',
    ]),
    "",
  ].join("\n")]));
}
