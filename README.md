# 3db-socketio

a 3db plugin to enable socket.io communication to and from 3db.

see [3suite-db](https://github.com/3sig/3suite-db) for more information, including installation instructions.

## usage

see `orchestrator.json5` for annotated configuration details.

3db-socketio *does not* host its own socketio server, it connects to one. see [3suite-socketio](https://github.com/3sig/3suite-socketio) for a simple server.

3db-socketio passes through all messages received from the socketio server to the 3db instance. it also sends messages to the socketio server whenever a database entry is changed or added, or whenever a database entry is accessed. this means you can send a `core/get` message to retrieve a database entry.

3db-socketio currently supports up to two parameters. the first parameter is inferred from the message type, and the second parameter is the data sent in. for example, to write "world" to "hello", send a `core/update/hello` message with "world" as the data.

to read back the "hello" entry, simply send `core/get/hello` with no data.

3db-socketio currently doesn't add any additional APIs.

## development

### creating a release

ensure that you are in a fully committed state before creating a tag.
run `npm run release` (or `bun run release`) and follow the prompts.
