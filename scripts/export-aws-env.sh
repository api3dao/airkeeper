# !/bin/bash
test -f config/aws.env && export $(egrep -v '^#' config/aws.env | xargs)