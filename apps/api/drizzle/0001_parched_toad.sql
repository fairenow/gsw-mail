ALTER TYPE "public"."delivery_event_type" ADD VALUE 'complained' BEFORE 'failed';--> statement-breakpoint
ALTER TABLE "outbound_delivery_events" ADD COLUMN "provider_event_id" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "client_request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_event_provider_idx" ON "outbound_delivery_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_client_request_idx" ON "outbound_messages" USING btree ("client_request_id");