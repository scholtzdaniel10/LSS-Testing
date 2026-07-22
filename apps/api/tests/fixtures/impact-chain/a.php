<?php

// impact-chain fixture root: b.php -> a.php, c.php -> b.php, d.php -> c.php.
// A seeded error here must report exactly 3 downstream files (DX-7 AC).
function broken(): int
{
    return 'not-an-int';
}
