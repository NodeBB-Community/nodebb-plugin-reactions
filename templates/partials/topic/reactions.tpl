{{{ if config.enablePostReactions }}}
<span class="reactions" component="post/reactions" data-pid="{./pid}">
  {{{ each ./reactions }}}
    <!-- IMPORT partials/topic/reaction.tpl -->
  {{{ end }}}
  <a href="#" class="reaction-add btn btn-ghost btn-sm {{{ if ./maxReactionsReached }}}max-reactions{{{ end }}}" component="post/reaction/add" data-pid="{./pid}" title="[[reactions:add-reaction]]">
    <i class="fa fa-face-smile text-primary"></i>
  </a>
</span>
{{{ end }}}