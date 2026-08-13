# commit-archaeologist demo
#
# Recorded against the synthetic fixture — see scripts/skill-evals/build-fixture.py.
# The history shown is planted: an issue ref, a workaround marked temporary, and
# a revert of that workaround by a second author.
#
# Regenerate:  npm run skills:demos
# Output:      docs/assets/demos/commit-archaeologist.gif

Output "../../../docs/assets/demos/commit-archaeologist.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1300
Set Height 660
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type "cd ${DEVHUB_FIXTURE:-/tmp/devhub-skill-fixture}/archaeology-repo && clear"
Enter
Type "alias archaeologist='python3 $SKILL/archaeologist.py'"
Enter
Type "clear"
Enter
Show

Type "# git blame tells you who touched a line last."
Enter
Sleep 1600ms

Type "git blame -L 1,3 src/cache.py"
Enter
Sleep 2800ms

Type "# It doesn't tell you why the line exists. This does."
Enter
Sleep 1800ms

Type "archaeologist . src/cache.py"
Enter
Sleep 5500ms

Type "# Origin, a revert, and the workaround that got reverted — with evidence."
Enter
Sleep 3000ms
