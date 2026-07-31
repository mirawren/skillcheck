# Support

Start with the [project website](https://mirawren.github.io/skillcheck/) for the short path from
first run to CI. The complete references cover [rules](docs/rules.md), [trigger
scenarios](docs/scenarios.md), [activation simulation](docs/trigger-simulation.md), and
[language support](docs/languages.md).

## When the output is surprising

Run the command with its normal human-readable output and keep the complete finding:

```sh
npx skillcheck .
npx skillcheck why "the request that should reach my skill"
```

The rule id in parentheses links the result to `skillcheck explain <rule>` and the
[rule reference](docs/rules.md). A close trigger result is evidence about competing wording, not
a prediction of a model run; the [simulation guide](docs/trigger-simulation.md) describes that
boundary precisely.

## Open the right report

- A correct file was flagged: open a [false-positive
  report](https://github.com/mirawren/skillcheck/issues/new?template=false-positive.yml). These
  reports get priority.
- A command crashed, hung, missed a failure, or returned the wrong result: open a [bug
  report](https://github.com/mirawren/skillcheck/issues/new?template=bug-report.yml).
- A language is missing: open a [new-language
  request](https://github.com/mirawren/skillcheck/issues/new?template=language-support.yml).
- A supported language is read incorrectly: open an [incorrect-language
  report](https://github.com/mirawren/skillcheck/issues/new?template=language-result.yml).
- A new check has a documented silent failure mode: open a [rule
  proposal](https://github.com/mirawren/skillcheck/issues/new?template=rule-proposal.yml).
- A vulnerability could expose files, execute code, open a socket, or write outside the requested
  path: follow [SECURITY.md](SECURITY.md) and report it privately.

Please use public issues only for public information. Remove credentials, private repository
content, and identifying data from every reproduction.
