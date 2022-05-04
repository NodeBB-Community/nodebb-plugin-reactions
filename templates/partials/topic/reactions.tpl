<span class="reactions" component="post/reactions" data-pid="{./pid}">
  <span class="reaction-add {{{ if ./maxReactionsReached }}}max-reactions{{{ end }}}" component="post/reaction/add" data-pid="{./pid}" title="[[reactions:add-reaction]]">
    <i class="fa fa-plus-square-o"></i>
  </span>
  {{{ each ./reactions }}}
    <!-- IMPORT partials/topic/reaction.tpl -->
  {{{ end }}}
</span>