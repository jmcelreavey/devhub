# project-graveyard demo
#
# Recorded against the synthetic fixture — see scripts/skill-evals/build-fixture.py.
# `tab-sensei`, `recipe-scraper` and `side-hustle` are invented. Do NOT re-record
# this against a real projects directory: the report names abandoned projects and
# reads commit emails.
#
# Regenerate:  npm run skills:demos
# Output:      docs/assets/demos/project-graveyard.gif

Output "../../../docs/assets/demos/project-graveyard.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1300
Set Height 780
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type "cd ${DEVHUB_FIXTURE:-/tmp/devhub-skill-fixture} && clear"
Enter
Type "alias graveyard='python3 $SKILL/graveyard.py'"
Enter
Type "clear"
Enter
Show

Type "# Four projects. Which are dead, and what killed them?"
Enter
Sleep 1800ms

Type "graveyard graveyard --days 45 --me fixture@example.invalid"
Enter
Sleep 7000ms

Type "# Causes are read from git history, each with the evidence behind it."
Enter
Sleep 3000ms
