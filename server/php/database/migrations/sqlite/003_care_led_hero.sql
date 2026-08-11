UPDATE slides
SET image_url = '/images/campaign/story-care.webp',
    eyebrow = 'Our beginning · Since 2019',
    title = 'Care began',
    emphasis = 'at home.',
    copy_text = 'First made to care for family, our body ritual has grown through research, making and patient refinement.',
    caption = 'Family care · Made in Malaysia · Since 2019',
    tone = 'light',
    position_value = 'center 42%',
    sort_order = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'from-moringa';

UPDATE slides
SET image_url = '/images/generated-v3/slider-botanical-leaf-v3.webp',
    eyebrow = 'Main ingredient · Moringa leaves',
    title = 'From moringa,',
    emphasis = 'care takes root.',
    copy_text = 'Fresh moringa leaves are the botanical centre of our Body Oil and Body Cream ritual.',
    caption = 'Moringa oleifera · Body Oil · Body Cream',
    tone = 'light',
    position_value = 'center',
    sort_order = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'care-began-at-home';
