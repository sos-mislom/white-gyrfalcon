import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { z } from "zod";

// One source for runtime validation and OpenAPI; no hand-maintained DTO copies.
export function openApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0" }) as SchemaObject;
}
