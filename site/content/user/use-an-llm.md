Construct never needs an AI model. Two places can use one, and only when you ask.

{{include docs/execution-model.md#The governing principle level=2 nohead}}

## Choosing a provider

`--llm claude` runs the local `claude` command-line tool (it must be installed and signed in). `--llm ollama` calls a local Ollama server, by default at `http://localhost:11434` with the model `qwen2.5-coder:7b`.

```bash
construct create layer Invoice --feature billing --layers domain,hook,page,controller --llm ollama
```

Which layers get created is still decided by Construct; the model only fills in the body of files that were going to be created anyway.

## Model output is checked before it is written

{{include docs/execution-model.md#LLM output is validated before it is written level=3 nohead}}
