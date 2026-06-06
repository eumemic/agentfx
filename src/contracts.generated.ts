// AUTO-GENERATED from the live iii engine by `npm run gen`. Do not edit by hand.
// Each entry's types are derived from that worker's declared contract — any language.

export interface Contracts {
  "agentfx::greet": { input: { "name": string; "times": number }; output: string };
  "agentfx::parseAmount": { input: string; output: number };
  "configuration::get": { input: { "id": string; "raw"?: boolean }; output: { "id": string; "value": unknown } };
  "configuration::list": { input: Record<string, never>; output: { "configurations": unknown[] } };
  "configuration::register": { input: { "description": string; "id": string; "initial_value"?: unknown; "metadata"?: unknown; "name": string; "schema": unknown }; output: { "description": string; "id": string; "metadata"?: unknown; "name": string; "schema": unknown; "value"?: unknown } };
  "configuration::schema": { input: { "id": string }; output: { "description": string; "id": string; "metadata"?: unknown; "name": string; "schema": unknown } };
  "configuration::set": { input: { "id": string; "value": unknown }; output: { "new_value": unknown; "old_value"?: unknown } };
  "iii::durable::publish": { input: { "data": unknown; "topic": string }; output: unknown };
  "iii::queue::discard_message": { input: { "message_id": string; "queue": string }; output: { "message_id": string; "queue": string; "redriven": number } };
  "iii::queue::redrive": { input: { "queue": string }; output: { "queue": string; "redriven": number } };
  "iii::queue::redrive_message": { input: { "message_id": string; "queue": string }; output: { "message_id": string; "queue": string; "redriven": number } };
  "publish": { input: { "data": unknown; "topic": string }; output: unknown };
  "pymath::add": { input: { "a": number; "b": number }; output: { "sum": number } };
  "sensor::heartbeat": { input: unknown; output: unknown };
  "state::delete": { input: { "key": string; "scope": string }; output: unknown };
  "state::get": { input: { "key": string; "scope": string }; output: unknown };
  "state::list": { input: { "scope": string }; output: unknown };
  "state::list_groups": { input: Record<string, never>; output: { "groups": string[] } };
  "state::set": { input: { "key": string; "scope": string; "value": unknown }; output: { "new_value": unknown; "old_value"?: unknown } };
  "state::update": { input: { "key": string; "ops": unknown[]; "scope": string }; output: { "errors"?: unknown[]; "new_value": unknown; "old_value"?: unknown } };
  "stream::delete": { input: { "group_id": string; "item_id": string; "stream_name": string }; output: { "old_value"?: unknown } };
  "stream::get": { input: { "group_id": string; "item_id": string; "stream_name": string }; output: unknown };
  "stream::list": { input: { "group_id": string; "stream_name": string }; output: unknown };
  "stream::list_all": { input: Record<string, never>; output: { "count": number; "stream": unknown[] } };
  "stream::list_groups": { input: { "stream_name": string }; output: unknown };
  "stream::send": { input: { "data": unknown; "group_id": string; "id"?: unknown; "stream_name": string; "type": string }; output: unknown };
  "stream::set": { input: { "data": unknown; "group_id": string; "item_id": string; "stream_name": string }; output: { "new_value": unknown; "old_value"?: unknown } };
  "stream::update": { input: { "group_id": string; "item_id": string; "ops": unknown[]; "stream_name": string }; output: { "errors"?: unknown[]; "new_value": unknown; "old_value"?: unknown } };
  "worker::add": { input: unknown; output: { "awaited_ready": boolean; "config_path": string; "name": string; "status": unknown; "version"?: unknown } };
  "worker::clear": { input: unknown; output: { "cleared_bytes": number } };
  "worker::list": { input: unknown; output: { "workers": unknown[] } };
  "worker::remove": { input: unknown; output: { "removed": string[] } };
  "worker::schema": { input: unknown; output: { "schemas": unknown[] } };
  "worker::start": { input: unknown; output: { "name": string; "pid"?: unknown; "port"?: unknown } };
  "worker::stop": { input: unknown; output: { "name": string; "stopped": boolean } };
  "worker::update": { input: unknown; output: { "updated": unknown[] } };
}
