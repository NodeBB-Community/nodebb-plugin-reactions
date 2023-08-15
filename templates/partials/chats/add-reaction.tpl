{{{ if config.enableMessageReactions }}}
<button class="reaction-add btn btn-sm btn-link {{{ if ./maxReactionsReached }}}max-reactions{{{ end }}}" component="message/reaction/add" data-mid="{./mid}" title="[[reactions:add-reaction]]">
    <i class="fa fa-face-smile"></i>
</button>
{{{ end }}}

