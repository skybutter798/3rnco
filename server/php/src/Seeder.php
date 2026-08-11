<?php

declare(strict_types=1);

namespace Rnco;

final class Seeder
{
    public function __construct(private readonly Database $database)
    {
    }

    /** @return array<string, int> */
    public function seed(): array
    {
        $counts = ['admin' => 0, 'settings' => 0, 'paymentMethods' => 0, 'products' => 0, 'slides' => 0, 'gallery' => 0, 'bundles' => 0];
        $now = Security::now();

        $counts['admin'] += $this->insertIgnore('users', [
            'public_id' => Security::uuid(),
            'role' => 'admin',
            'username' => 'admin',
            'email' => null,
            'password_hash' => Security::passwordHash('88888888'),
            'first_name' => 'Store',
            'last_name' => 'Administrator',
            'display_name' => '3R&Co Admin',
            'phone' => null,
            'date_of_birth' => null,
            'marketing_consent' => 0,
            'status' => 'active',
            'must_change_password' => 1,
            'email_verified_at' => null,
            'last_login_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $settings = [
            'storeName' => '3R&Co Malaysia',
            'supportEmail' => 'support@3rnco.com.my',
            'whatsappDisplay' => '+60 17-781 6398',
            'whatsappNumber' => '60177816398',
            'instagramHandle' => '@3rnco',
            'instagramUrl' => 'https://www.instagram.com/3rnco',
            'facebookUrl' => 'https://www.facebook.com/officially3randco/',
            'announcement' => 'Moringa-led body care · Made in Malaysia',
            'shippingThreshold' => 180.0,
            'shippingFee' => 12.0,
            'currency' => 'MYR',
            'country' => 'Malaysia',
        ];
        foreach ($settings as $key => $value) {
            $counts['settings'] += $this->insertIgnore('settings', [
                'setting_key' => $key,
                'value_json' => Security::jsonEncode($value),
                'is_public' => 1,
                'updated_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach ([
            ['id' => 'duitnow-qr', 'type' => 'duitnow_qr', 'name' => 'DuitNow QR', 'sort' => 0],
            ['id' => 'touch-n-go-qr', 'type' => 'tng_qr', 'name' => "Touch 'n Go eWallet QR", 'sort' => 1],
            ['id' => 'bank-transfer', 'type' => 'bank_transfer', 'name' => 'Bank transfer', 'sort' => 2],
        ] as $method) {
            $counts['paymentMethods'] += $this->insertIgnore('payment_methods', [
                'id' => $method['id'], 'method_type' => $method['type'], 'display_name' => $method['name'], 'is_active' => 0,
                'instructions' => 'Complete the transfer, then upload your receipt from My account.', 'qr_image_url' => null,
                'bank_name' => null, 'account_name' => null, 'account_number' => null, 'sort_order' => $method['sort'], 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        foreach ($this->products() as $sort => $product) {
            $counts['products'] += $this->insertIgnore('products', [
                'id' => $product['id'],
                'sku' => $product['sku'],
                'name' => $product['name'],
                'short_name' => $product['shortName'],
                'price_cents' => (int) round($product['price'] * 100),
                'stock_quantity' => 0,
                'status' => 'active',
                'badge' => $product['badge'],
                'description' => $product['description'],
                'detail' => $product['detail'],
                'ingredients' => $product['ingredients'],
                'ritual' => $product['ritual'],
                'volume' => $product['volume'],
                'image_url' => $product['image'],
                'editorial_url' => $product['editorial'],
                'editorial_position' => $product['editorialPosition'],
                'texture' => $product['texture'],
                'benefits_json' => Security::jsonEncode($product['benefits']),
                'story_images_json' => Security::jsonEncode($product['storyImages']),
                'sort_order' => $sort,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach ($this->slides() as $sort => $slide) {
            $counts['slides'] += $this->insertIgnore('slides', [
                'id' => $slide['id'],
                'image_url' => $slide['image'],
                'eyebrow' => $slide['eyebrow'],
                'title' => $slide['title'],
                'emphasis' => $slide['emphasis'],
                'copy_text' => $slide['copy'],
                'caption' => $slide['caption'],
                'tone' => $slide['tone'],
                'position_value' => $slide['position'],
                'sort_order' => $sort,
                'is_active' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach ($this->gallery() as $sort => $item) {
            $counts['gallery'] += $this->insertIgnore('gallery_items', [
                'id' => sprintf('instagram-%02d', $sort + 1),
                'image_url' => $item['image'],
                'alt_text' => $item['alt'],
                'caption' => $item['caption'],
                'href' => $item['href'],
                'sort_order' => $sort,
                'is_active' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $counts['bundles'] += $this->insertIgnore('bundles', [
            'id' => 'two-step',
            'name' => 'Build the two-step set',
            'title' => 'Choose two textures. Make it yours.',
            'description' => 'Begin with a cleansing step, then choose the finishing layer that suits your ritual.',
            'pricing_mode' => 'sum',
            'fixed_price_cents' => null,
            'sort_order' => 0,
            'is_active' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->insertIgnore('bundle_steps', [
            'id' => 'cleanse',
            'bundle_id' => 'two-step',
            'name' => 'Step one · Cleanse',
            'prompt_text' => 'Choose the first movement.',
            'min_select' => 1,
            'max_select' => 1,
            'sort_order' => 0,
        ]);
        $this->insertIgnore('bundle_steps', [
            'id' => 'layer',
            'bundle_id' => 'two-step',
            'name' => 'Step two · Layer',
            'prompt_text' => 'Choose a cream or oil finish.',
            'min_select' => 1,
            'max_select' => 1,
            'sort_order' => 1,
        ]);
        $this->insertIgnore('bundle_step_products', [
            'step_id' => 'cleanse', 'product_id' => 'champion-soap', 'price_adjustment_cents' => 0, 'is_default' => 1, 'sort_order' => 0,
        ]);
        foreach (['body-cream', 'tree-body-oil'] as $sort => $productId) {
            $this->insertIgnore('bundle_step_products', [
                'step_id' => 'layer', 'product_id' => $productId, 'price_adjustment_cents' => 0, 'is_default' => $sort === 0 ? 1 : 0, 'sort_order' => $sort,
            ]);
        }

        $counts['bundles'] += $this->insertIgnore('bundles', [
            'id' => 'gift-set',
            'name' => 'Build a gift set',
            'title' => 'Gather three gestures of care.',
            'description' => 'Choose a cleansing companion, a nourishing layer, and something to carry close.',
            'pricing_mode' => 'sum',
            'fixed_price_cents' => null,
            'sort_order' => 1,
            'is_active' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        foreach ([
            ['gift-cleanse', 'Step one · Cleanse', 'Begin the gift with a grounding cleanse.', 0],
            ['gift-care', 'Step two · Care', 'Choose a cream or full-size botanical oil.', 1],
            ['gift-carry', 'Step three · Carry', 'Add a travel ritual for care away from home.', 2],
        ] as [$stepId, $name, $prompt, $sort]) {
            $this->insertIgnore('bundle_steps', [
                'id' => $stepId, 'bundle_id' => 'gift-set', 'name' => $name, 'prompt_text' => $prompt,
                'min_select' => 1, 'max_select' => 1, 'sort_order' => $sort,
            ]);
        }
        $this->insertIgnore('bundle_step_products', [
            'step_id' => 'gift-cleanse', 'product_id' => 'champion-soap', 'price_adjustment_cents' => 0, 'is_default' => 1, 'sort_order' => 0,
        ]);
        foreach (['body-cream', 'tree-body-oil'] as $sort => $productId) {
            $this->insertIgnore('bundle_step_products', [
                'step_id' => 'gift-care', 'product_id' => $productId, 'price_adjustment_cents' => 0, 'is_default' => $sort === 0 ? 1 : 0, 'sort_order' => $sort,
            ]);
        }
        $this->insertIgnore('bundle_step_products', [
            'step_id' => 'gift-carry', 'product_id' => 'tree-body-oil-travel', 'price_adjustment_cents' => 0, 'is_default' => 1, 'sort_order' => 0,
        ]);

        return $counts;
    }

    /** @param array<string, mixed> $values */
    private function insertIgnore(string $table, array $values): int
    {
        $columns = array_keys($values);
        $prefix = $this->database->isMysql() ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        $quoted = array_map(fn (string $column): string => $this->database->isMysql() ? '`' . $column . '`' : '"' . $column . '"', $columns);
        $sql = sprintf(
            '%s INTO %s (%s) VALUES (%s)',
            $prefix,
            $table,
            implode(', ', $quoted),
            implode(', ', array_fill(0, count($columns), '?')),
        );

        return $this->database->execute($sql, array_values($values));
    }

    /** @return list<array<string, mixed>> */
    private function products(): array
    {
        return [
            [
                'id' => 'body-cream', 'sku' => '3R-BC-001', 'name' => 'Body Cream', 'shortName' => 'Cream', 'price' => 69.0, 'badge' => 'Texture 02',
                'description' => 'A velvety moringa body cream for skin that needs lasting comfort.',
                'detail' => 'A rich yet easy-to-spread cream designed as the final layer of your daily ritual. Moringa extract and plant oils leave skin feeling soft, supple and cared for, while kaffir lime adds a fresh botanical note.',
                'ingredients' => 'Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.',
                'ritual' => 'Massage a small amount into clean, slightly damp skin, focusing on elbows, knees and areas that need extra comfort.', 'volume' => 'Extra hydration · Jar',
                'image' => '/images/products/body-cream.webp', 'editorial' => '/images/product-stories/body-cream-poster-v2.png', 'editorialPosition' => '50% 50%',
                'texture' => 'Velvety and cushion-rich, with a smooth finish and fresh botanical scent.',
                'benefits' => ['Helps soften dry-feeling skin', 'Comforting moisture for daily care', 'Moringa and plant-oil blend'],
                'storyImages' => [
                    ['image' => '/images/generated-v3/body-cream-texture-v4.webp', 'alt' => 'Ivory cream texture with fresh moringa and kaffir lime peel', 'eyebrow' => 'Texture study', 'title' => 'A richer layer of care.', 'copy' => 'Velvety cream wraps skin in comforting moisture, with moringa extract and plant oils at the centre.'],
                    ['image' => '/images/generated-v3/body-cream-ritual-v3.webp', 'alt' => 'A hand slowly smoothing body cream over a forearm', 'eyebrow' => 'The application', 'title' => 'Smooth. Press. Restore.', 'copy' => 'Warm a small amount between the palms, then massage it over clean, slightly damp skin in slow, upward movements.'],
                ],
            ],
            [
                'id' => 'champion-soap', 'sku' => '3R-CS-001', 'name' => 'Champion Soap Bar', 'shortName' => 'Soap', 'price' => 57.0, 'badge' => 'Cleansing companion',
                'description' => 'A grounding scrub bar that begins the everyday ritual with water.',
                'detail' => 'A handmade cleansing bar with a tactile mineral finish. Begin with warm water, work gently between the hands, and rinse thoroughly.',
                'ingredients' => 'Aqua, sodium hydroxide, extra virgin olive oil, moringa powder, black seed powder, coconut powder, ginger, lime and vanilla essential oils.',
                'ritual' => 'Work between wet hands, glide over skin and rinse thoroughly.', 'volume' => 'Handmade scrub bar',
                'image' => '/images/products/champion-soap.webp', 'editorial' => '/images/product-stories/champion-soap-poster-v2.png', 'editorialPosition' => '50% 50%',
                'texture' => 'A firm handmade bar with a gently tactile scrub character.',
                'benefits' => ['Fresh-feeling cleanse', 'Tactile body polish', 'Easy everyday ritual'],
                'storyImages' => [
                    ['image' => '/images/generated-v3/soap-lather-v3.webp', 'alt' => 'Irregular translucent handmade soap bar covered in fresh lather', 'eyebrow' => 'The true soap character', 'title' => 'Handmade, tactile, alive.', 'copy' => 'The irregular translucent bar and active lather follow the supplied soap reference, rebuilt as a fresh editorial scene.'],
                    ['image' => '/images/generated-v3/soap-oil-study-v3.webp', 'alt' => 'Translucent soap beside golden botanical oil and fresh moringa', 'eyebrow' => 'Cleansing study', 'title' => 'Water first. Pressure light.', 'copy' => 'Build a soft lather between wet hands, glide over the body and rinse well before the next layer.'],
                ],
            ],
            [
                'id' => 'tree-body-oil', 'sku' => '3R-BO-001', 'name' => 'Tree Body Oil', 'shortName' => 'Body Oil', 'price' => 138.0, 'badge' => 'Texture 01',
                'description' => 'The signature botanical oil, made for a slow and sensorial finish.',
                'detail' => 'Our signature body ritual blends familiar botanical oils into a sensorial finishing layer. Apply sparingly and massage with intention.',
                'ingredients' => 'Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.',
                'ritual' => 'Apply a small amount to slightly damp skin and massage gently.', 'volume' => 'Full size · Pump bottle',
                'image' => '/images/products/tree-body-oil.webp', 'editorial' => '/images/product-stories/tree-body-oil-poster-v2.png', 'editorialPosition' => '50% 50%',
                'texture' => 'Silken, fluid and luminous with a warm botanical aroma.',
                'benefits' => ['Massage-friendly glide', 'Soft-looking finish', 'Signature moringa ritual'],
                'storyImages' => [
                    ['image' => '/images/generated-v3/body-oil-texture-v3.webp', 'alt' => 'Luminous golden botanical oil with a fresh moringa branch', 'eyebrow' => 'Oil study', 'title' => 'A luminous finishing layer.', 'copy' => 'A little goes a long way: the fluid texture offers enough slip for a slow, considered massage.'],
                    ['image' => '/images/generated-v3/body-oil-ritual-v3.webp', 'alt' => 'A hand massaging body oil over a forearm', 'eyebrow' => 'The application', 'title' => 'Begin on damp skin.', 'copy' => 'Apply sparingly after bathing so the oil can move easily while the skin still holds a trace of water.'],
                ],
            ],
            [
                'id' => 'tree-body-oil-travel', 'sku' => '3R-BOT-010', 'name' => 'Tree Body Oil Travel', 'shortName' => 'Travel Oil', 'price' => 49.0, 'badge' => 'Keep it close',
                'description' => 'A compact companion for care beyond home.',
                'detail' => 'The signature ritual in a 10ml roll-on for your daily bag, weekend ritual or first introduction to 3R&Co.',
                'ingredients' => 'Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.',
                'ritual' => 'Keep close and use whenever your day needs a softer reset.', 'volume' => '10ml · Roll-on',
                'image' => '/images/product-stories/tree-body-oil-travel-single-v2.png', 'editorial' => '/images/product-stories/tree-body-oil-travel-single-v2.png', 'editorialPosition' => '50% 50%',
                'texture' => 'The same silken oil ritual in a controlled, compact format.',
                'benefits' => ['Single 10ml bottle', 'Bag-ready format', 'Targeted roll-on ritual'],
                'storyImages' => [
                    ['image' => '/images/generated-v3/travel-pouch-v3.webp', 'alt' => 'One small amber roll-on oil bottle beside a linen travel pouch', 'eyebrow' => 'One small oil', 'title' => 'Moringa travels, too.', 'copy' => 'The small format keeps the collection’s central botanical story close without adding a second product.'],
                    ['image' => '/images/generated-v3/travel-hand-v3.webp', 'alt' => 'A hand holding one small amber travel oil above an everyday bag', 'eyebrow' => 'Keep it close', 'title' => 'A pause that fits the day.', 'copy' => 'Roll a small amount onto the skin whenever you want to return to the familiar 3R&Co ritual.'],
                ],
            ],
        ];
    }

    /** @return list<array<string, string>> */
    private function slides(): array
    {
        return [
            ['id' => 'from-moringa', 'image' => '/images/campaign/story-care-essence-v3.webp', 'eyebrow' => 'Relieve · Restore · Rejuvenate', 'title' => 'Come home', 'emphasis' => 'to care.', 'copy' => 'Born from family care in 2019, our moringa-led body ritual is made to relieve, restore and bring you gently back to yourself.', 'caption' => 'Family care · Made in Malaysia · Since 2019', 'tone' => 'light', 'position' => 'center'],
            ['id' => 'care-began-at-home', 'image' => '/images/generated-v3/slider-botanical-leaf-v3.webp', 'eyebrow' => 'Main ingredient · Moringa leaves', 'title' => 'From moringa,', 'emphasis' => 'care takes root.', 'copy' => 'Fresh moringa leaves are the botanical centre of our Body Oil and Body Cream ritual.', 'caption' => 'Moringa oleifera · Body Oil · Body Cream', 'tone' => 'light', 'position' => 'center'],
            ['id' => 'rooted-in-moringa', 'image' => '/images/moringa-slider/moringa-ingredient-table.webp', 'eyebrow' => 'The complete ritual', 'title' => 'Rooted in', 'emphasis' => 'moringa.', 'copy' => 'One botanical story, expressed through a fluid Body Oil and a rich Body Cream texture.', 'caption' => 'Two textures · One botanical heart', 'tone' => 'light', 'position' => 'center'],
        ];
    }

    /** @return list<array<string, string>> */
    private function gallery(): array
    {
        return [
            ['image' => '/images/instagram/brand-ritual.jpg', 'alt' => '3R&Co Body Cream, Body Oil and cleansing bar with green fruit and botanicals', 'caption' => 'Care began at home.', 'href' => 'https://www.instagram.com/3rnco/p/DbdV8N1iT0h/'],
            ['image' => '/images/instagram/body-oil.jpg', 'alt' => 'Full-size and travel Tree Body Oil bottles among fresh green fruit', 'caption' => 'Two sizes. One familiar ritual.', 'href' => 'https://www.instagram.com/3rnco/p/Dbdbei4CVva/'],
            ['image' => '/images/instagram/family-care.jpg', 'alt' => 'A woman applying body oil during a quiet family-care moment', 'caption' => 'Care, held close.', 'href' => 'https://www.instagram.com/3rnco/p/Dbrmj6hCee8/'],
            ['image' => '/images/instagram/oil-texture.jpg', 'alt' => 'A 3R&Co Tree Body Oil pump bottle being used', 'caption' => 'A little warmth, returned to skin.', 'href' => 'https://www.instagram.com/3rnco/p/Dbdbei4CVva/'],
            ['image' => '/images/instagram/story-products.jpg', 'alt' => '3R&Co products with the words Made for one, now shared with the right ones', 'caption' => 'Made for one. Shared with the right ones.', 'href' => 'https://www.instagram.com/3rnco/p/DbesZwppgDA/'],
            ['image' => '/images/instagram/care-began-home.jpg', 'alt' => '3R&Co body ritual products with the words Began at home', 'caption' => 'Two textures. One complete ritual.', 'href' => 'https://www.instagram.com/3rnco/p/DbdV8N1iT0h/'],
            ['image' => '/images/instagram/body-cream.jpg', 'alt' => 'Golden botanical oil in a shallow bowl with a wooden spoon', 'caption' => 'Botanical oil, slowly gathered.', 'href' => 'https://www.instagram.com/3rnco/p/Dbdbei4CVva/'],
            ['image' => '/images/instagram-more/heritage-reel.jpg', 'alt' => '3R&Co small travel oil in a warm home interior', 'caption' => 'The small ritual, kept close.', 'href' => 'https://www.instagram.com/3rnco/reel/C-Uvs3RSHZE/'],
            ['image' => '/images/instagram-more/care-reel.jpg', 'alt' => '3R&Co body-care texture being massaged into skin', 'caption' => 'Feel the wonder in every layer.', 'href' => 'https://www.instagram.com/3rnco/reel/Cd-P866p5CK/'],
            ['image' => '/images/instagram-more/ritual-reel.jpg', 'alt' => '3R&Co Body Cream and Tree Body Oil together', 'caption' => 'Two textures, one decision.', 'href' => 'https://www.instagram.com/3rnco/reel/DEPZlQiSBJ3/'],
            ['image' => '/images/instagram-more/moringa-reel.jpg', 'alt' => '3R&Co green botanical product packaging', 'caption' => 'Hello to a botanical favourite.', 'href' => 'https://www.instagram.com/3rnco/reel/CsXeNU5s0LG/'],
        ];
    }
}
