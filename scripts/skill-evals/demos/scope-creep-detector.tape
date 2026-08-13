# scope-creep-detector demo
#
# Recorded against the synthetic fixture, never a real repository — see
# scripts/skill-evals/build-fixture.py. Nothing here is a real project name,
# commit subject or author email, so the output is publishable unredacted.
#
# Regenerate:  npm run skills:demos
# Output:      docs/assets/demos/scope-creep-detector.gif

Output "../../../docs/assets/demos/scope-creep-detector.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1300
Set Height 620
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type "cd ${DEVHUB_FIXTURE:-/tmp/devhub-skill-fixture}/scope-repo && clear"
Enter
Type "alias scope-creep='python3 $SKILL/scope_creep.py'"
Enter
Type "clear"
Enter
Show

Type "# A branch that says it fixes cache expiry. Does it?"
Enter
Sleep 1600ms

Type "git diff --stat main...HEAD"
Enter
Sleep 2600ms

Type "# Five files. Ask the skill which of them the intent actually covers."
Enter
Sleep 1800ms

Type "scope-creep --repo . --base main --intent 'fix cache expiry'"
Enter
Sleep 5500ms

Type "# One file in scope, four that overran it — each with its own reason."
Enter
Sleep 3000ms
