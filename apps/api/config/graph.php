<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Overview aggregation cap
    |--------------------------------------------------------------------------
    |
    | Hard maximum for GET /projects/{project}/graph/overview?limit= (fileCap)
    | and GET /graph/rollup folder count. Overview may still return more nodes
    | than this value because folder hubs and error files are always kept.
    | Rollup never fills leftover slots with files.
    |
    */

    'aggregate_max_nodes' => (int) env('GRAPH_AGGREGATE_MAX_NODES', 200),

];
