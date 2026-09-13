ALTER TABLE "contacts" ADD COLUMN "stalwart_contact_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "stalwart_address_book_id" text;--> statement-breakpoint
CREATE INDEX "contacts_stalwart_idx" ON "contacts" USING btree ("owner_user_id","stalwart_contact_id");